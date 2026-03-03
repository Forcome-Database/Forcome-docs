from langgraph.graph import StateGraph, END

from app.agent.state import AgentState
from app.agent.nodes.planner import planner_node
from app.agent.nodes.researcher import researcher_node
from app.agent.nodes.executor import executor_node
from app.agent.nodes.reviewer import reviewer_node

def should_continue(state: AgentState) -> str:
    """决定 Reviewer 之后是结束还是回到 Planner 修正"""
    if state.get("needs_revision") and state.get("iteration_count", 0) < state.get("max_iterations", 3):
        return "revise"
    return "end"

def build_agent_graph():
    """构建并编译 LangGraph 图"""
    graph = StateGraph(AgentState)

    graph.add_node("planner", planner_node)
    graph.add_node("researcher", researcher_node)
    graph.add_node("executor", executor_node)
    graph.add_node("reviewer", reviewer_node)

    graph.set_entry_point("planner")
    graph.add_edge("planner", "researcher")
    graph.add_edge("researcher", "executor")
    graph.add_edge("executor", "reviewer")
    graph.add_conditional_edges("reviewer", should_continue, {
        "revise": "planner",
        "end": END,
    })

    return graph.compile()

agent_graph = build_agent_graph()
