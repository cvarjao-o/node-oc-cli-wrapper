'use strict';

//const {spawn, spawnSync} = require('child_process');
//const path = require('path');
const crypto = require('crypto')
//const fs = require('fs');

const log4js = require('log4js');

const CONSTANTS = Object.freeze({
  KINDS: {
    LIST: 'List',
    BUILD: 'Build',
    BUILD_CONFIG: 'BuildConfig',
    IMAGE_STREAM: 'ImageStream',
    IMAGE_STREAM_TAG: 'ImageStreamTag',
    IMAGE_STREAM_IMAGE: 'ImageStreamImage'
  },
  ENV:{
    BUILD_HASH: '_BUILD_HASH'
  },
  LABELS:{
    TEMPLATE_HASH: 'template-hash',
    SOURCE_HASH: 'source-hash'
  },
  ANNOTATIONS: {
    TEMPLATE_HASH: 'template-hash',
    SOURCE_HASH: 'source-hash'
  },
  POD_PHASES: {
    PENDING: 'Pending',
    RUNNING: 'Running',
    SUCCEEDED :'Succeeded',
    FAILED: 'Failed',
    UNKNOWN: 'Unknown'
  }
});

function gitHashString(itemAsString){
  var shasum = crypto.createHash('sha1');
  //var itemAsString = JSON.stringify(resource)
  shasum.update(`blob ${itemAsString.length + 1}\0${itemAsString}\n`);
  return shasum.digest('hex');
}

function gitHashObject(resource){
  //var shasum = crypto.createHash('sha1');
  var itemAsString = JSON.stringify(resource)
  //shasum.update(`blob ${itemAsString.length + 1}\0${itemAsString}\n`);
  return gitHashString(itemAsString)
}

function shortName (resource) {
  return resource.metadata.name
}

function fullName (resource) {
  return resource.kind + '/' + resource.metadata.name
}

function appendArg(prefix, item, result){
  if (item instanceof Array){
    item.forEach((subitem)=>{
      appendArg(prefix, subitem, result)
    })
  }else if (!((item instanceof String) || (typeof item === "string")) && item instanceof Object){
    for (var prop in item) {
      if(!item.hasOwnProperty(prop)) continue;
      appendArg(`${prefix}=${prop}`, item[prop], result)
    }
  }else{
    result.push(`${prefix}=${item}`)
  }
}

function asArray(args){
  if (args instanceof Array) return args;
  const result=[]
  for (var prop in args) {
    // skip  loop if the property is from prototype
    if(!args.hasOwnProperty(prop)) continue;
    var value=args[prop]
    appendArg(`--${prop}`, value, result)
  }
  return result
}

/**
 * Move all global options (oc options) from source to target. Both objects are modified in-place.
 * @param {Object} target
 * @param {Object} source 
 * @private
 * @returns {Object} The modified target object
 */
function moveGlobalOptions (target, source) {
  const whitelist=['as', 'as-group', 'cache-dir', 'context', 'config', 'loglevel', 'namespace', 'v']
  for (var prop in source) {
    // skip  loop if the property is from prototype
    if(!source.hasOwnProperty(prop)) continue;
    if (whitelist.indexOf(prop) >=0){
      target[prop]=source[prop]
      delete source[prop]
    }
  }
  return target
}

function getLogger(name){
  return log4js.getLogger(name)
}
function configureLogging(args){
  log4js.configure(args)
}

module.exports = exports = {
  CONSTANTS: CONSTANTS,
  hashObject: gitHashObject,
  hashString: gitHashString,
  shortName: shortName,
  fullName: fullName,
  asArray: asArray,
  moveGlobalOptions: moveGlobalOptions,
  getLogger:getLogger,
  configureLogging: configureLogging
}