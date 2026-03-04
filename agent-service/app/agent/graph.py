"""LangGraph agent graph with interrupt-based human-in-the-loop.

Topology:
  Explorer → Clarifier → (interrupt) → Proposer → (interrupt)
  → Outliner → (interrupt) → Writer → Reviewer → (loop or END)
"""
from langgraph.graph import StateGraph, END

from app.agent.state import AgentState
from app.agent.nodes.explorer import explorer_node
from app.agent.nodes.clarifier import clarifier_node
from app.agent.nodes.proposer import proposer_node
from app.agent.nodes.outliner import outliner_node
from app.agent.nodes.writer import writer_node
from app.agent.nodes.reviewer import reviewer_node


def should_continue(state: AgentState) -> str:
    """After Reviewer: revise (back to Writer) or end."""
    if state.get("needs_revision") and state.get("iteration_count", 0) < state.get("max_iterations", 3):
        return "revise"
    return "end"


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

    graph.add_node("explorer", explorer_node)
    graph.add_node("clarifier", clarifier_node)
    graph.add_node("proposer", proposer_node)
    graph.add_node("outliner", outliner_node)
    graph.add_node("writer", writer_node)
    graph.add_node("reviewer", reviewer_node)

    graph.set_entry_point("explorer")

    graph.add_edge("explorer", "clarifier")
    graph.add_edge("clarifier", "proposer")
    graph.add_edge("proposer", "outliner")

    graph.add_conditional_edges("outliner", should_regenerate_outline, {
        "regenerate": "outliner",
        "continue": "writer",
    })

    graph.add_edge("writer", "reviewer")

    graph.add_conditional_edges("reviewer", should_continue, {
        "revise": "writer",
        "end": END,
    })

    return graph


agent_graph_builder = build_agent_graph()
