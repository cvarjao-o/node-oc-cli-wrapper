'use strict';
/**
 * A module that offers a thin wrapper over `oc` command
 * @module oc-helper
 */
const path = require('path');
const fs = require('fs');

const {spawnSync} = require('child_process');

function transformers (client) {
  const logger = client.util.getLogger('oc.helper.transformers');
  const CONSTANTS = client.util.CONSTANTS;
  return {
    ENSURE_METADATA: (resource, container)=>{
      resource.metadata = resource.metadata || {}
      resource.metadata.labels = resource.metadata.labels || {}
      resource.metadata.annotations = resource.metadata.annotations || {}
    },
    ENSURE_METADATA_NAMESPACE: (resource, container)=>{
      resource.metadata.namespace = resource.metadata.namespace || container.namespace || client.settings.options.namespace
    },
    ADD_CHECKSUM_LABEL: (resource)=>{
      resource.metadata.labels[CONSTANTS.LABELS.TEMPLATE_HASH] = client.util.hashObject(resource)
    },
    REMOVE_BUILD_CONFIG_TRIGGERS: (resource)=>{
      if (resource.kind === CONSTANTS.KINDS.BUILD_CONFIG) {
        if (resource.spec.triggers && resource.spec.triggers.length > 0){
          logger.warn(`'${resource.kind}/${resource.metadata.name}' .spec.triggers are being removed and will be managed by this build script`)
        }
        resource.spec.triggers = []
      }
    },
    ADD_SOURCE_HASH: (resource)=>{
      //logger.trace(`cwd:${client.settings.cwd}`)
      if (resource.kind === CONSTANTS.KINDS.BUILD_CONFIG) {
        //ugly way of guarantee safe navigation (nullable object within a path. e.g.: `resource.spec.source`)
        var contextDir=(((resource || {}).spec || {}).source || {}).contextDir || ''
        var sourceHash = null;

        if (resource.spec.source.type === 'Git'){
          //git tree-hash are more stable than commit-hash
          sourceHash = spawnSync('git', ['rev-parse', `HEAD:${contextDir}`], {'cwd':client.settings.cwd}).stdout.toString().trim()
        }else if (resource.spec.source.type === 'Binary'){
          var rootWorkDir = spawnSync('git', ['rev-parse', '--show-toplevel'], {'cwd':client.settings.cwd}).stdout.toString().trim()
          var absoluteContextDir=path.join(rootWorkDir, contextDir)
          logger.trace(`contextDir:${contextDir} \t absoluteContextDir:${absoluteContextDir}`)
          var hashes=[]

          //find . -type f -exec git hash-object -t blob --no-filters '{}' \;
          var walk=(start, basedir)=>{
            var files=fs.readdirSync(absoluteContextDir)
            var stat = fs.statSync(start);
            if (stat.isDirectory()) {
              files.reduce(function (acc, name) {
                var abspath = path.join(start, name);
                //hashes.push()
                if (fs.statSync(abspath).isDirectory()) {
                  walk(abspath, basedir)
                }else{
                  var hash = spawnSync('git', ['hash-object', '-t', 'blob', '--no-filters', abspath], {'cwd':client.settings.cwd}).stdout.toString().trim()
                  //console.dir({'name':name, 'hash':hash})
                  hashes.push({'name':abspath.substr(basedir.length + 1), 'hash':hash})
                }
              }, null)
            }
          }

          //collect hash of all files
          walk(absoluteContextDir, absoluteContextDir)
          //sort array to remove any OS/FS specific ordering
          hashes.sort((a,b) =>{
            if (a.name < b.name)
              return -1;
            if (a.name > b.name)
              return 1;
            return 0;
          });
          //console.dir(hashes)
          sourceHash = client.util.hashObject(hashes)
        }

        //logger.trace(`sourceHash:${sourceHash} (${contextDir})`)
        resource.metadata.labels[CONSTANTS.LABELS.SOURCE_HASH] = sourceHash;
      }
    }
  }
}
module.exports = exports = {
  transformers:transformers
}
