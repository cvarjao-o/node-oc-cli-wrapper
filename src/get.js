'use strict';
/**
 * A module that offers a thin wrapper over `oc` command
 * @module oc-helper
 */
const log4js = require('log4js');
const logger = log4js.getLogger('oc-helper/oc-get');

const {spawn, spawnSync} = require('child_process');
//const path = require('path');
//const crypto = require('crypto')
const fs = require('fs');

function getSync (client) {
  return function create (args = {}) {
    //resource is a special parameter
    const globalOptions =  client.util.moveGlobalOptions(Object.assign({}, client.settings.options), args)
    const opt =  Object.assign({'output':'json'}, args)
    const resources = opt.resource || opt.resources
    const names = []
    if (resources){
      if (resources instanceof Array){
        names.push(...resources)
      }else{
        names.push(resources)
      }
    }

    delete opt.resource
    delete opt.resources
    const cmdArgs = client.util.asArray(globalOptions).concat(['get'], names, client.util.asArray(opt))
    logger.trace('getSync', ['oc'].concat(cmdArgs).join(' '))
    const process=spawnSync('oc', cmdArgs, {'cwd':client.settings.cwd, encoding:'utf-8'})

    return process.stdout.trim()
  }
}

function ocGetToFileSync (client) {
  return function create (args = {}, filepath) {
    const content=client.getSync(args)
    fs.writeFileSync(filepath, content)
    return filepath
  }
}

module.exports = exports = {
  getSync: getSync,
  getToFileSync: ocGetToFileSync
}