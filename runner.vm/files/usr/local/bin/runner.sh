#!/bin/bash

set -euo pipefail
CURL="curl -s -L -f --retry 5 --retry-connrefused"

GITHUB_RUNNER_REG_URL=$(${CURL} "http://metadata.google.internal/computeMetadata/v1/instance/attributes/runnerURL" -H "Metadata-Flavor: Google")
GITHUB_RUNNER_TOKEN=$(${CURL} "http://metadata.google.internal/computeMetadata/v1/instance/attributes/runnerToken" -H "Metadata-Flavor: Google")
GITHUB_RUNNER_LABEL=$(${CURL} "http://metadata.google.internal/computeMetadata/v1/instance/attributes/runnerLabel" -H "Metadata-Flavor: Google")

RUNNER_RELEASE_URL=$(${CURL} https://api.github.com/repos/actions/runner/releases/latest | \
                     jq -e -r '.assets[] | if .name | test("actions-runner-linux-x64-[0-9.]+.tar") then .browser_download_url else empty end')
${CURL} -O "${RUNNER_RELEASE_URL}"
tar xf *.tar.*
rm *.tar.*

./config.sh --url "${GITHUB_RUNNER_REG_URL}" --token "${GITHUB_RUNNER_TOKEN}" --ephemeral --disableupdate --unattended --labels "${GITHUB_RUNNER_LABEL}"
./run.sh
