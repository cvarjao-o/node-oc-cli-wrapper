'use strict';
/**
 * A module that offers a thin wrapper over `oc` command
 * @module oc-helper
 */

const log4js = require('log4js');
const logger = log4js.getLogger('oc-helper');
const {spawn, spawnSync} = require('child_process');
const fs = require('fs');
const plugins = [require('./build.js'), require('./get.js'), require('./transformers.js')]

const util = require('./util.js')
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

function toOcCommandArguments(client, action, args){
  const opt =  Object.assign({}, args)
  const globalOptions =  client.util.moveGlobalOptions(Object.assign({}, client.settings.options), opt)
  const resources = opt.resource || opt.resources || opt.names
  const names = []

  if (resources){
    if (resources instanceof Array){
      names.push(...resources)
    }else{
      names.push(resources)
    }
    delete opt.resource
    delete opt.resources
    delete opt.names
  }
  
  return util.asArray(globalOptions).concat([action], names, util.asArray(opt))
}

function _ocSpawn (client) {
  /**
   * @member _ocSpawn
   * @function
   * @param action {string}
   * @param args {Object} 
   * @return {Promise<ChildProcess>}
   */
  return function create (action, args = {}) {
    return new Promise(function(resolve, reject) {
      const cmdArgs = toOcCommandArguments(client, action, args)
      logger.trace('ocSpawn', ['oc'].concat(cmdArgs).join(' '))
      const _options = {cwd:client.settings.cwd};
      resolve(spawn('oc', cmdArgs, _options));
    });
  };
}

function _ocSpawnAndReturnStdout (client) {
  /**
   * @member _ocSpawnAndReturnStdout
   * @function
   * @param action {string}
   * @param args {Object} 
   * @return {Promise<ChildProcess>}
   */
  return function create (action, args = {}) {
    return client._ocSpawn(action, args).then((process)=>{
      return new Promise(function(resolve, reject) {
        let stdout=''
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
      })
    })
  };
}

function _ocSpawnSync (client) {
  /**
   * @member _ocSpawnSync
   * @function
   * @param action {string}
   * @param args {Object} 
   * @return {SpawnSyncReturns<string>}
   */
  return function create (action, args = {}) {
    //return new Promise(function(resolve, reject) {
      const cmdArgs = toOcCommandArguments(client, action, args)
      logger.trace('ocSpawnSync', ['oc'].concat(cmdArgs).join(' '))
      const _options = {cwd:client.settings.cwd, encoding:'utf-8'};
      return spawnSync('oc', cmdArgs, _options);
    //});
  };
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
  /** Helper for `oc process`. Each object is used to create a command line call to `oc process`
   * @member process
   * @function
   * @param args {(Object|Object[])} one ore more template processing definition. The properties will become arguments for `oc process`
   * @returns {Promise} Array of resources created or updated
   * @see https://www.mankier.com/1/oc-process
   */
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
        return client._ocSpawnAndReturnStdout('process', Object.assign({output:'json'}, template)).then((result)=>{
          let output=JSON.parse(result.stdout)
          items.push(...output.items)
        });
      })
    }, Promise.resolve()).then(result => {
      return Promise.resolve({'kind':'List', 'items':items, 'metadata':{'annotations':{'namespace':client.settings.options.namespace}}})
    })
  };
}

function ocLogsToFileSync (client) {
  return function create (args = {}, filepath) {
    const process=client._ocSpawnSync('logs', args)
    fs.writeFileSync(filepath, process.stdout.trim())
    return filepath
  }
}

function ocLogsSync (client) {
  return function create (args = {}) {
    const process=client._ocSpawnSync('logs', args)
    return process.stdout.trim()
  }
}


function ocApply (client) {
  /** Helper for `oc apply`
   * @member apply
   * @function
   * @param args {Object}
   * @returns {Promise} Array of resources created or updated
   * @see https://www.mankier.com/1/oc-apply
   */
  var create = function (args = {}) {
    var items=null;
    var tmpfile=null;
    var _args = args
    if (_args instanceof Object && _args.kind === util.CONSTANTS.KINDS.LIST && _args.items){
      _args={filename:_args}
    }

    if (!(_args instanceof Array)) {
      //logger.trace('!args instanceof Array')
      if (!(_args['filename'] instanceof String)){
        //logger.trace('!args["filename"] instanceof String')
        items=_args['filename']
        var json=JSON.stringify(items);
        var jsonHash=util.hashString(json);
        tmpfile=`/tmp/${jsonHash}.json`;

        fs.writeFileSync(tmpfile, json)
        _args['filename']=tmpfile
        //stdin=(stdin)=>{stdin.setEncoding('utf-8'); stdin.write(json); stdin.end();}
      }
    }

    return client._ocSpawnAndReturnStdout('apply', Object.assign({output:'json'}, _args))
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

function prepare (client) {
  return (list) => {
    return new Promise((resolve, reject) => {
      if (list.kind != 'List') throw "Expected {kind:'List'}"

      list.items.forEach (item  => {
        client.transformers.ENSURE_METADATA(item);
        client.transformers.ADD_CHECKSUM_LABEL(item);
        client.transformers.ENSURE_METADATA_NAMESPACE(item, list);
        client.transformers.REMOVE_BUILD_CONFIG_TRIGGERS(item);
        client.transformers.ADD_SOURCE_HASH(item);
      })

      return resolve(list);
    });
  };
}

/**
 * @function
 * @param {Object} settings 
 */
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
  client['_ocSpawn'] = _ocSpawn(client)
  client['_ocSpawnAndReturnStdout'] = _ocSpawnAndReturnStdout(client)
  client['_ocSpawnSync'] = _ocSpawnSync(client)
  //client['_raw'] = _oc(client)
  client['process'] = ocProcess(client)
  client['apply'] = ocApply(client)
  client['prepare'] = prepare(client)
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
