#!/bin/bash
# Monthly KPI update launcher — opened by launchd (com.wooof.kpi-monthly) on the 1st.
# Runs the MONTHLY-UPDATE.md runbook in an interactive Claude Code session.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v claude >/dev/null 2>&1; then
  echo "claude 명령을 찾지 못했습니다. Claude Code 설치/PATH를 확인해 주세요."
  read -n 1 -s -r -p "아무 키나 누른 뒤 창을 닫아 주세요."
  exit 1
fi

claude "KPI 월간 갱신 — MONTHLY-UPDATE.md 런북을 읽고 그대로 실행해줘"
