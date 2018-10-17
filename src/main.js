'use strict';
/**
 * A module that offers a thin wrapper over `oc` command
 * @module oc-helper
 */

const log4js = require('log4js');
const logger = log4js.getLogger('oc-helper');
const {spawn, spawnSync} = require('child_process');
const path = require('path');
const crypto = require('crypto')
const fs = require('fs');
const plugins = [require('./build.js')]

const util = require('./util.js')
const fullName = util.fullName
const shortName = util.shortName
const CONSTANTS = util.CONSTANTS
const asArray = util.asArray;

//https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
//function warn(args){
//  logger.warn('\x1b[31m', args ,'\x1b[0m');
//}

//https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
function die(args){
  logger.error('\x1b[31m', args ,'\x1b[0m');
  process.exit(1)
}

function check_prerequisites(){
  var proc=spawnSync('oc', ['whoami'])
  var errors = ''
  //logger.trace(`oc (exit code = ${proc.status})`)
  if (proc.status == 0){
    //no-op
  }else if (proc.status == 1){
    errors+="Not authenticated (oc whoami) (exit code = 1)\n"
  }else if (proc.status == 127){
    errors+="'oc' command not found (exit code = 127)\n"
  }else if (proc.status == 126){
    errors+="'oc' command found, but not executable (exit code = 126)\n"
  }else{
    errors+=`Error tryng to run oc (exit code = ${proc.status}):\n`
    errors+='  stdout:'+proc.stdout+'\n'
    errors+='  stderr:'+proc.stderr+'\n'
  }

  var proc2=spawnSync('git', ['version'])
  //logger.trace(`git (exit code = ${proc2.status})`)
  if (proc2.status == 0){
    //no-op
  }else{
    errors+=`Error trying to run git (exit code = ${proc2.status})\n`
    errors+='stdout:'+proc2.stdout+'\n'
    errors+='stderr:'+proc2.stderr+'\n'
  }

  if (errors.length > 0){
    throw `Prerequisites not met!\n${errors}`
  }
}

function _oc (client) {
  return function create (args = [], stdin = null) {
    return new Promise(function(resolve, reject) {
      const _args = asArray(client.settings.options).concat(asArray(args))
      const _options = {cwd:client.settings.cwd};
      logger.trace(`oc ${_args.join(' ')}    cwd: ${_options.cwd}`)
      
      //logger.trace(`cwd: ${_options.cwd}`)

      const process = spawn('oc', _args, _options);
      let stdout=''
      if (stdin!=null){
        stdin(process.stdin)
      }
      process.stdout.on('data', (data) => {
        //logger.trace(`1>${data}`)
        stdout+=data
      });
      process.stderr.on('data', (data) => {
        logger.trace(`2>${data}`)
      })
      process.on('exit', (code) => {
        resolve({'code':code, 'stdout':stdout})
      });  
    });
  };
}

function ocProcess (client) {
  return function create (args) {
    let items=[]
    let templates=[]

    if (args instanceof Array){
      templates.push(...args)
    }else{
      templates.push(args)
    }

    return templates.reduce((chain, template)=>{
      return chain.then(()=>{
        const _args=['process', '--output=json'].concat(asArray(template))

        return client._raw(_args).then((result)=>{
          let output=JSON.parse(result.stdout)
          items.push(...output.items)
        });
      })
    }, Promise.resolve()).then(result => {
      return Promise.resolve({'kind':'List', 'items':items, 'metadata':{'annotations':{'namespace':client.settings.options.namespace}}})
    })
  };
}
/**
 * Move all global options (oc options) from source to target. Both objects are modified in-place.
 * @param {Object} target
 * @param {Object} source 
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

function ocLogsToFileSync (client) {
  return function create (args = {}, filepath) {
    //resource is a special parameter
    const globalOptions =  moveGlobalOptions(Object.assign({}, client.settings.options), args)
    const opt =  Object.assign({}, args)
    const resources = opt.resource || opt.resources || opt.names
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
    delete opt.names
    const cmdArgs = asArray(globalOptions).concat(['logs'], names, asArray(opt))
    logger.trace('ocLogsSync', ['oc'].concat(cmdArgs).join(' '))
    const process=spawnSync('oc', cmdArgs, {'cwd':client.settings.cwd, encoding:'utf-8'})
    
    fs.writeFileSync(filepath, process.stdout.trim())

    return filepath
  }
}

function ocLogsSync (client) {
  return function create (args = {}) {
    //resource is a special parameter
    const globalOptions =  moveGlobalOptions(Object.assign({}, client.settings.options), args)
    const opt =  Object.assign({}, args)
    const resources = opt.resource || opt.resources || opt.names
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
    delete opt.names
    const cmdArgs = asArray(globalOptions).concat(['logs'], names, asArray(opt))
    logger.trace('ocLogsSync', ['oc'].concat(cmdArgs).join(' '))
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

function ocGetSync (client) {
  return function create (args = {}) {
    //resource is a special parameter
    const globalOptions =  moveGlobalOptions(Object.assign({}, client.settings.options), args)
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
    const cmdArgs = asArray(globalOptions).concat(['get'], names, asArray(opt))
    logger.trace('ocGetSync', ['oc'].concat(cmdArgs).join(' '))
    const process=spawnSync('oc', cmdArgs, {'cwd':client.settings.cwd, encoding:'utf-8'})

    return process.stdout.trim()
  }
}


function ocApply (client) {
  /**
   * @member apply
   * @function
   * @param args {(Object|Object[])}
   * @returns {Promise} Array of resources created or updated
   */
  var create = function (args = []) {
    var stdin=null;
    var items=null;
    var tmpfile=null;
    if (!(args instanceof Array)) {
      //logger.trace('!args instanceof Array')
      if (!(args['filename'] instanceof String)){
        //logger.trace('!args["filename"] instanceof String')
        items=args['filename']
        var json=JSON.stringify(items);
        var jsonHash=util.hashString(json);
        tmpfile=`/tmp/${jsonHash}.json`;

        fs.writeFileSync(tmpfile, json)
        args['filename']=tmpfile
        //stdin=(stdin)=>{stdin.setEncoding('utf-8'); stdin.write(json); stdin.end();}
      }
    }

    const _args=['apply', '--output=json'].concat(asArray(args))
    return client._raw(_args, stdin)
    .then((result)=>{
      fs.unlinkSync(tmpfile)
      return result
    })
    .then((result)=>{
      //json output is in stream format
      var items=result.stdout.split(/\n}\n{\n/);
      
      items.forEach((value, index)=>{
        if (items.length > 1){
          if (index == 0 ) {
            value += '}'
          }else if (index == items.length - 1 ) {
            value = '{' + value
          }else{
            value = '{' + value + '}'
          }
        }
        //logger.trace(`[${index}]=${value}`)
        items[index]=JSON.parse(value)
      });
      //require('fs').writeFile('_oc_apply_stdout.json', result.stdout, 'utf8')
      return items; //JSON.parse(result.stdout)
    });
  };

  return create;
}

const resource_transformers = {
  ENSURE_METADATA: (resource, container, client)=>{
    resource.metadata = resource.metadata || {}
    resource.metadata.labels = resource.metadata.labels || {}
    resource.metadata.annotations = resource.metadata.annotations || {}
  },
  ENSURE_METADATA_NAMESPACE: (resource, container, client)=>{
    resource.metadata.namespace = resource.metadata.namespace || container.namespace || client.settings.options.namespace
  },
  ADD_CHECKSUM_LABEL: (resource)=>{
    resource.metadata.labels[CONSTANTS.LABELS.TEMPLATE_HASH] = util.hashObject(resource)
  },
  REMOVE_BUILD_CONFIG_TRIGGERS: (resource)=>{
    if (resource.kind === CONSTANTS.KINDS.BUILD_CONFIG) {
      if (resource.spec.triggers && resource.spec.triggers.length > 0){
        logger.warn(`'${resource.kind}/${resource.metadata.name}' .spec.triggers are being removed and will be managed by this build script`)
      }
      resource.spec.triggers = []
    }
  },
  ADD_SOURCE_HASH: (resource, client)=>{
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
        sourceHash = util.hashObject(hashes)
      }

      //logger.trace(`sourceHash:${sourceHash} (${contextDir})`)
      resource.metadata.labels[CONSTANTS.LABELS.SOURCE_HASH] = sourceHash;
    }
  }
}

function prepare (client) {
  return (list) => {
    return new Promise((resolve, reject) => {
      if (list.kind != 'List') throw "Expected {kind:'List'}"

      list.items.forEach (item  => {
        resource_transformers.ENSURE_METADATA(item)
        resource_transformers.ADD_CHECKSUM_LABEL(item)
        resource_transformers.ENSURE_METADATA_NAMESPACE(item, list, client)
        resource_transformers.REMOVE_BUILD_CONFIG_TRIGGERS(item),
        resource_transformers.ADD_SOURCE_HASH(item, client)
      })

      return resolve(list);
    });
  };
}

function openShiftClient (settings = {}) {
  const client = {};
  settings = settings || {}
  settings.options =settings.options || {}
  
  check_prerequisites()

  if (!settings.cwd){
    settings.cwd = spawnSync('git', ['rev-parse', '--show-toplevel'], {encoding:'utf-8'}).stdout.trim()
    logger.trace('Setting cwd', settings.cwd)
  }
  client['util'] = util
  client['settings']=settings
  client['_raw'] = _oc(client)
  client['process'] = ocProcess(client)
  client['apply'] = ocApply(client)
  client['prepare'] = prepare(client)
  client['getSync'] = ocGetSync(client)
  client['getToFileSync'] = ocGetToFileSync(client)
  client['logsToFileSync'] = ocLogsToFileSync(client)
  
  
  //client['startBuild'] = ocStartBuild(client)
  //client['startBuilds'] = startBuilds(client)

  plugins.forEach (plugin => {
    for (var prop in plugin) {
      // skip  loop if the property is from prototype
      if(!plugin.hasOwnProperty(prop)) continue;
      var value=plugin[prop]
      client[prop] = value(client)
    }
  })
  return client;
}

module.exports = exports = openShiftClient;
