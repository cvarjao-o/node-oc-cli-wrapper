#!/usr/bin/env sh
set -e

NODE_VERSION='10.11.0'
NODE_ARCH='x64'
NODE_PLATFORM='linux'
NODE_EXTENSION='tar.xz'
if [[ "$OSTYPE" == "darwin"* ]]; then
  NODE_PLATFORM='darwin'
  NODE_EXTENSION='tar.gz'
fi
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}.${NODE_EXTENSION}"
NODE_PKG_NAME="node-v${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}.${NODE_EXTENSION}"

#rm -rf .node node_modules

#echo "NODE_URL=${NODE_URL}"
if [ ! -f "/tmp/${NODE_PKG_NAME}" ]; then
  echo "Downloading Node:${NODE_VERSION} ..."
  curl -sSL "${NODE_URL}" -o "/tmp/${NODE_PKG_NAME}"
fi
NODE_HOME=".node/node-v${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}"
if [ ! -d "${NODE_HOME}" ]; then
  mkdir -p ".node"
  if [[ "$NODE_EXTENSION" == "tar.xz" ]]; then
    tar -xf "/tmp/${NODE_PKG_NAME}" -C ".node"
  else
    tar -xzf "/tmp/${NODE_PKG_NAME}" -C ".node"
  fi
fi

export PATH="${NODE_HOME}/bin:$PATH"

#TODO: set NPM_CONFIG_PREFIX

#npm install npm@latest -g
echo "node: $(node --version) (from $(which node))"
echo "npm: $(npm --version) (from $(which npm))"

#export NPM_CONFIG_CACHE="$(pwd)/.npm/cache"
#export NPM_CONFIG_LOGLEVEL='verbose'
#export NPM_CONFIG_USERCONFIG="$(pwd)/.npmrc"
#npm config ls -l
#unset NPM_CONFIG_LOGLEVEL

#if [ ! -d "node_modules" ]; then
  #rm -rf node_modules
  #npm list -g --depth 0
  NODE_ENV=PRODUCTION "${NODE_HOME}/bin/npm" "ci"
  #NODE_ENV=PRODUCTION "${NODE_HOME}/bin/npm" "install" --no-audit
#fi

exec "${NODE_HOME}/bin/npm" run-script "$@"