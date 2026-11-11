#!/usr/bin/env bash
# 下载 Protomaps 每日构建的 OpenStreetMap 底图中某个范围，生成本服务自带的 PMTiles 底图（backend/tiles/）
# 需要 go-pmtiles CLI（BSD-3）：https://github.com/protomaps/go-pmtiles/releases
#   用法：scripts/fetch-tiles.sh [bbox] [maxzoom] [输出文件名]
#   默认：北京中心城区演示范围，最高 15 级，约 11 MB
#   全国范围（73,18,135,54，maxzoom 15）约数 GB，建议放到国内对象存储，再设置 MAP_PMTILES_URL
# 数据许可：ODbL（© OpenStreetMap contributors），必须在地图上显示署名。
set -euo pipefail
BBOX="${1:-116.25,39.85,116.50,40.00}"
MAXZOOM="${2:-15}"
OUT="${3:-beijing-demo.pmtiles}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/tiles"
PMTILES="${PMTILES_BIN:-pmtiles}"
mkdir -p "$DIR"
# 找最近 10 天内存在的每日构建（https://maps.protomaps.com/builds）
for i in $(seq 1 10); do
  D=$(date -u -d "-$i day" +%Y%m%d)
  if curl -sfI "https://build.protomaps.com/$D.pmtiles" >/dev/null; then BUILD=$D; break; fi
done
: "${BUILD:?找不到最近的 Protomaps 构建}"
echo "使用构建 $BUILD，范围 $BBOX，最高 $MAXZOOM 级"
"$PMTILES" extract "https://build.protomaps.com/$BUILD.pmtiles" "$DIR/$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM" --download-threads=8
ls -la "$DIR/$OUT"
