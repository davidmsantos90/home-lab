#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PYTHON_VERSION="${PYTHON_VERSION:-3.13}"
YARSS2_REVISION="${YARSS2_REVISION:-ad8b89e95178}"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/dist}"

mkdir -p "$OUTPUT_DIR"

docker run --rm \
  -e TARGET_PYTHON_VERSION="$PYTHON_VERSION" \
  -e YARSS2_REVISION="$YARSS2_REVISION" \
  -v "$OUTPUT_DIR:/output" \
  "python:${PYTHON_VERSION}-alpine" sh -c '
    set -eu
    apk add --no-cache curl
    python -m pip install --no-cache-dir setuptools
    curl -fsSL \
      "https://bitbucket.org/bendikro/deluge-yarss-plugin/get/${YARSS2_REVISION}.tar.gz" \
      -o /tmp/yarss2.tar.gz
    mkdir /tmp/yarss2
    tar xzf /tmp/yarss2.tar.gz -C /tmp/yarss2 --strip-components=1
    cd /tmp/yarss2
    sed -i "/'"'"'version'"'"': atoma_result.version,/d" yarss2/rssfeed_handling.py
    rm -rf yarss2/include/requests yarss2/include/urllib3 yarss2/include/certifi \
      yarss2/include/dateutil yarss2/include/defusedxml yarss2/include/beautifulsoup \
      yarss2/include/soupsieve yarss2/include/html5lib yarss2/include/webencodings
    python setup.py bdist_egg
    cp dist/YaRSS2-*-py${TARGET_PYTHON_VERSION}.egg /output/
  '

echo "Built: $OUTPUT_DIR/YaRSS2-2.1.5-py${PYTHON_VERSION}.egg"