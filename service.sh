#!/bin/bash

# Report Web Service 守护脚本
# 自动重启服务如果它崩溃了

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$APP_DIR/server.log"
PID_FILE="$APP_DIR/server.pid"

check_service() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

start_service() {
    echo "[$(date)] Starting Report Web Service..."
    cd "$APP_DIR"
    nohup node server.js >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 2
    if check_service; then
        echo "[$(date)] Service started successfully (PID: $(cat $PID_FILE))"
    else
        echo "[$(date)] Failed to start service"
    fi
}

stop_service() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        echo "[$(date)] Stopping service (PID: $PID)..."
        kill "$PID" 2>/dev/null
        rm -f "$PID_FILE"
    fi
}

case "$1" in
    start)
        if check_service; then
            echo "Service is already running (PID: $(cat $PID_FILE))"
        else
            start_service
        fi
        ;;
    stop)
        stop_service
        ;;
    restart)
        stop_service
        sleep 1
        start_service
        ;;
    status)
        if check_service; then
            echo "Service is running (PID: $(cat $PID_FILE))"
        else
            echo "Service is not running"
        fi
        ;;
    monitor)
        # 监控模式：每30秒检查一次，如果服务挂了自动重启
        echo "[$(date)] Monitor mode started"
        while true; do
            if ! check_service; then
                echo "[$(date)] Service not running, restarting..."
                start_service
            fi
            sleep 30
        done
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|monitor}"
        exit 1
        ;;
esac
