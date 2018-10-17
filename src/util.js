'use strict';

//const {spawn, spawnSync} = require('child_process');
//const path = require('path');
const crypto = require('crypto')
//const fs = require('fs');

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

function asArray(args){
  if (args instanceof Array) return args;
  const result=[]
  for (var prop in args) {
    // skip  loop if the property is from prototype
    if(!args.hasOwnProperty(prop)) continue;
    var value=args[prop]
    if (value instanceof Array){
      value.forEach((item)=>{
        result.push(`--${prop}=${item}`)
      })
    }else{
      result.push(`--${prop}=${value}`)
    }
  }
  return result
}

module.exports = exports = {
  CONSTANTS: CONSTANTS,
  hashObject: gitHashObject,
  hashString: gitHashString,
  shortName: shortName,
  fullName: fullName,
  asArray: asArray
}