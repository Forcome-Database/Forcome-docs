#!/bin/bash
# =============================================================================
# Docmost 启动脚本
# 用法: ./setup.sh [dev|prod] [up|down|build|logs|restart|ps]
# 示例:
#   ./setup.sh dev          # 启动开发环境
#   ./setup.sh prod up      # 启动生产环境
#   ./setup.sh dev logs     # 查看开发环境日志
#   ./setup.sh dev down     # 停止开发环境
# =============================================================================

set -e

MODE="${1:-dev}"
ACTION="${2:-up}"

case "$MODE" in
  dev)
    ENV_FILE=".env.dev"
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"
    ;;
  prod)
    ENV_FILE=".env.prod"
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
    ;;
  *)
    echo "Usage: $0 [dev|prod] [up|down|build|logs|restart|ps]"
    echo ""
    echo "Modes:"
    echo "  dev   - Development (volume mount + hot reload)"
    echo "  prod  - Production (optimized build images)"
    echo ""
    echo "Actions:"
    echo "  up      - Start services (default)"
    echo "  down    - Stop and remove services"
    echo "  build   - Build/rebuild images"
    echo "  logs    - Follow service logs"
    echo "  restart - Restart services"
    echo "  ps      - Show running services"
    exit 1
    ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found."
  echo "Copy .env.example to $ENV_FILE and configure it first."
  exit 1
fi

COMPOSE_CMD="docker compose $COMPOSE_FILES --env-file $ENV_FILE"

case "$ACTION" in
  up)
    echo "Starting Docmost ($MODE mode)..."
    $COMPOSE_CMD up -d --build
    echo ""
    echo "Services started. Use '$0 $MODE logs' to view logs."
    ;;
  down)
    echo "Stopping Docmost ($MODE mode)..."
    $COMPOSE_CMD down
    ;;
  build)
    echo "Building Docmost ($MODE mode)..."
    $COMPOSE_CMD build
    ;;
  logs)
    $COMPOSE_CMD logs -f
    ;;
  restart)
    echo "Restarting Docmost ($MODE mode)..."
    $COMPOSE_CMD restart
    ;;
  ps)
    $COMPOSE_CMD ps
    ;;
  *)
    echo "Unknown action: $ACTION"
    echo "Valid actions: up, down, build, logs, restart, ps"
    exit 1
    ;;
esac
