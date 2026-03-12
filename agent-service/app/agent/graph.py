"""LangGraph agent graph with interrupt-based human-in-the-loop.

Topology:
  Explorer → Clarifier → (interrupt) → Proposer → (interrupt)
  → Outliner → (interrupt) → Writer → Reviewer → END
"""
from langgraph.graph import StateGraph, END

from app.agent.state import AgentState
from app.agent.nodes.explorer import explorer_node
from app.agent.nodes.clarifier import clarifier_node
from app.agent.nodes.proposer import proposer_node
from app.agent.nodes.planner import planner_node
from app.agent.nodes.outliner import outliner_node
from app.agent.nodes.writer import writer_node
from app.agent.nodes.reviewer import reviewer_node
from app.agent.cancellation import cancellable


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

    graph.add_node("explorer", cancellable(explorer_node))
    graph.add_node("clarifier", cancellable(clarifier_node))
    graph.add_node("proposer", cancellable(proposer_node))
    graph.add_node("planner", cancellable(planner_node))
    graph.add_node("outliner", cancellable(outliner_node))
    graph.add_node("writer", cancellable(writer_node))
    graph.add_node("reviewer", cancellable(reviewer_node))

    graph.set_entry_point("explorer")

    graph.add_edge("explorer", "clarifier")
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
