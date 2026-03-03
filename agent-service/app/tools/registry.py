from langchain_core.tools import BaseTool

_registry: dict[str, BaseTool] = {}

def register_tool(tool: BaseTool):
    _registry[tool.name] = tool
    return tool

def get_all_tools() -> list[BaseTool]:
    return list(_registry.values())

def get_tool(name: str) -> BaseTool | None:
    return _registry.get(name)

def get_tool_names() -> list[str]:
    return list(_registry.keys())
