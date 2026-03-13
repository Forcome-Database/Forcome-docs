"""LangGraph agent graph with interrupt-based human-in-the-loop.

Topology:
  Explorer → Clarifier → (interrupt) → Proposer → (interrupt)
  → Outliner → (interrupt) → Writer → Reviewer → END
"""
from langgraph.graph import StateGraph, END

from app.agent.state import AgentState
from app.agent.nodes.evidence_acquirer import evidence_acquirer_node
from app.agent.nodes.evidence_gate import evidence_gate_node
from app.agent.nodes.explorer import explorer_node
from app.agent.nodes.clarifier import clarifier_node
from app.agent.nodes.proposer import proposer_node
from app.agent.nodes.planner import planner_node
from app.agent.nodes.outliner import outliner_node
from app.agent.nodes.writer import writer_node
from app.agent.nodes.reviewer import reviewer_node
from app.agent.cancellation import cancellable


async def intent_router_node(state: AgentState) -> dict:
    return {"phase": "router"}


def route_after_router(state: AgentState) -> str:
    intent_route = state.get("intent_route") or "document_create"
    if intent_route == "selection_edit":
        return "writer"
    return "explorer"


def route_after_explorer(state: AgentState) -> str:
    intent_route = state.get("intent_route") or "document_create"
    if intent_route == "document_transform":
        return "writer"
    return "clarifier"


def route_after_evidence_gate(state: AgentState) -> str:
    if state.get("phase") == "blocked":
        return "blocked"
    return route_after_router(state)


def should_regenerate_outline(state: AgentState) -> str:
    """After Outliner: if user requested regeneration, loop back."""
    if state.get("phase") == "outliner" and not state.get("confirmed_outline"):
        return "regenerate"
    return "continue"


def build_agent_graph():
    """Build and return the uncompiled graph builder.

    Compilation with checkpointer happens in main.py where DB pool is available.
    """
    graph = StateGraph(AgentState)

    graph.add_node("router", cancellable(intent_router_node))
    graph.add_node("evidence_acquirer", cancellable(evidence_acquirer_node))
    graph.add_node("evidence_gate", cancellable(evidence_gate_node))
    graph.add_node("explorer", cancellable(explorer_node))
    graph.add_node("clarifier", cancellable(clarifier_node))
    graph.add_node("proposer", cancellable(proposer_node))
    graph.add_node("planner", cancellable(planner_node))
    graph.add_node("outliner", cancellable(outliner_node))
    graph.add_node("writer", cancellable(writer_node))
    graph.add_node("reviewer", cancellable(reviewer_node))

    graph.set_entry_point("router")

    graph.add_edge("router", "evidence_acquirer")
    graph.add_edge("evidence_acquirer", "evidence_gate")
    graph.add_conditional_edges("evidence_gate", route_after_evidence_gate, {
        "blocked": END,
        "writer": "writer",
        "explorer": "explorer",
    })
    graph.add_conditional_edges("explorer", route_after_explorer, {
        "writer": "writer",
        "clarifier": "clarifier",
    })
    graph.add_edge("clarifier", "proposer")
    graph.add_edge("proposer", "planner")
    graph.add_edge("planner", "outliner")

    graph.add_conditional_edges("outliner", should_regenerate_outline, {
        "regenerate": "outliner",
        "continue": "writer",
    })

    graph.add_edge("writer", "reviewer")
    graph.add_edge("reviewer", END)

    return graph


agent_graph_builder = build_agent_graph()
