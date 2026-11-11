#!/usr/bin/env bash
# 本地构建 Docker 镜像（只构建，不推送任何镜像仓库）。
#
# 本仓库不再发布官方 Docker 镜像；需要容器化部署时用本脚本或
# `cd docker/delivery && docker compose build` 自行构建。
#
# 用法：
#   ./docker/build-images.sh [tag]        # 默认 tag 为 local
#   PLATFORMS=linux/amd64 ./docker/build-images.sh local
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${1:-local}"
TYPST_VERSION="${TYPST_VERSION:-0.14.2}"
PLATFORMS="${PLATFORMS:-}"
APP_IMAGE="${APP_IMAGE:-retainpdf-app:${TAG}}"
WEB_IMAGE="${WEB_IMAGE:-retainpdf-web:${TAG}}"

build_arg_flags=()
for var in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY; do
  val="${!var:-}"
  if [[ -n "${val}" ]]; then
    build_arg_flags+=(--build-arg "${var}=${val}")
  fi
done

build_cmd=(docker build)
if [[ -n "${PLATFORMS}" ]]; then
  # 指定平台时走 buildx；单平台用 --load 把结果载入本地镜像库。
  build_cmd=(docker buildx build --platform "${PLATFORMS}" --load)
fi

echo "=== Build ${APP_IMAGE} ==="
"${build_cmd[@]}" \
  "${build_arg_flags[@]}" \
  --build-arg "TYPST_VERSION=${TYPST_VERSION}" \
  -f "${ROOT_DIR}/docker/Dockerfile.app" \
  -t "${APP_IMAGE}" \
  "${ROOT_DIR}"

echo "=== Build ${WEB_IMAGE} ==="
"${build_cmd[@]}" \
  "${build_arg_flags[@]}" \
  --build-arg "RETAIN_PDF_VERSION=${TAG#v}" \
  -f "${ROOT_DIR}/docker/Dockerfile.web" \
  -t "${WEB_IMAGE}" \
  "${ROOT_DIR}"

echo ""
echo "镜像构建完成（未推送）："
echo "  ${APP_IMAGE}"
echo "  ${WEB_IMAGE}"
echo ""
echo "启动方式："
echo "  cd ${ROOT_DIR}/docker/delivery"
echo "  APP_IMAGE=${APP_IMAGE} WEB_IMAGE=${WEB_IMAGE} docker compose up -d"
