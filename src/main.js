'use strict';
/**
 * A module that offers a thin wrapper over `oc` command
 * - All methods return a Promise
 * - oc actions (get, apply, tag, delete, etc...) are kept as simple thin wrapper
 * - 'enhanced' property contains enhanced actions
 * - 'build' property contains enhanced build-related actions
 * - 'deployment' contains enhanced deployment-related actions
 * - arguments are passed as a key-value object where the key is the documented long form for `oc`
 * @module oc-helper
 */

const util = require('./util.js')
const logger = util.getLogger('oc-helper');
const {spawn, spawnSync} = require('child_process');
const fs = require('fs');
const plugins = [require('./basic.js'), require('./build.js'), require('./get.js'), require('./transformers.js')]
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

  //oc -n csnr-devops-lab-deploy policy add-role-to-user admin system:serviceaccount:csnr-devops-lab-tools:jenkins-cvarjao
  
  //oc -n csnr-devops-lab-deploy auth can-i create bc
  //oc -n csnr-devops-lab-deploy auth can-i create dc
  //oc -n csnr-devops-lab-deploy auth can-i create pod
  //oc -n csnr-devops-lab-deploy auth can-i create is
  if (errors.length > 0){
    throw `Prerequisites not met!\n${errors}`
  }
}

function collectResourceNames(item, names){
  if (item != null){
    if (item instanceof Array){
      item.forEach(subitem => {
        collectResourceNames(subitem, names)
      })
    }else if ((item instanceof String) || (typeof item === "string")){
      names.push(item)
    }else{ //consider it a plain object, so get its name
      if (item.kind === 'List'){
        collectResourceNames(item.items, names)
      }else{
        names.push(`${item.kind}/${item.metadata.name}`)
      }
    }
  }
  return names
}

function toOcCommandArguments(client, action, args){
  const opt =  Object.assign({}, args)
  const globalOptions =  client.util.moveGlobalOptions(Object.assign({}, client.settings.options), opt)
  const resources = opt.resource || opt.resources || opt.names
  const names = []

  if (resources){
    collectResourceNames(resources, names)
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
    const cmdArgs = toOcCommandArguments(client, action, args)
    const startTime = process.hrtime();
    return new Promise(function(resolve, reject) {
      logger.trace('>spawn',  ['oc'].concat(cmdArgs).join(' '))
      //logger.trace('ocSpawn', ['oc'].concat(cmdArgs).join(' '))
      const _options = {cwd:client.settings.cwd};
      resolve(spawn('oc', cmdArgs, _options))
    }).then(proc =>{
      proc.on('exit', (code) => {
        const duration = process.hrtime(startTime);
        logger.info(['oc'].concat(cmdArgs).join(' '),` # (${code}) [${duration[0]}s]`)
      })
      return proc;
    })
  };
}

function _ocSpawnAndWait (client) {
  /**
   * @member _ocSpawnAndWait
   * @function
   * @param action {string}
   * @param args {Object} 
   * @return {Promise<ChildProcess>}
   */
  return function create (action, args = {}) {
    return client._ocSpawn(action, args).then((process)=>{
      return new Promise(function(resolve, reject) {
        process.on('exit', (code) => {
          resolve({'code':code})
        });
      })
    })
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
          logger.error(`2>${data}`)
        })
        process.on('exit', (code) => {
          if (code != "0") {
            reject(new Error(`'oc ${action}' command returned ${code}`))
          }else{
            resolve({'code':code, 'stdout':stdout})
          }
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
      //logger.trace('ocSpawnSync', ['oc'].concat(cmdArgs).join(' '))
      const startTime = process.hrtime();
      logger.trace('>spawnSync',  ['oc'].concat(cmdArgs).join(' '))
      const _options = {cwd:client.settings.cwd, encoding:'utf-8'};
      const ret = spawnSync('oc', cmdArgs, _options);
      const duration = process.hrtime(startTime);
      logger.info(['oc'].concat(cmdArgs).join(' ') + ` # (${ret.status}) [${duration[0]}s]`)
      return ret;
    //});
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




function setBasicLabels (client) {
  /**
   * @member setBasicLabels
   * @function
   * @param result {Object} An OpenShift `List` (.kind = 'List')
   */
  return (result, appName, envName, envId) => {
    const commonLabels = {'app-name':appName}
    const envLabels={'env-name':envName, 'env-id':envId}
    const allLabels = Object.assign({'app':`${commonLabels['app-name']}-${envLabels['env-name']}-${envLabels['env-id']}`}, commonLabels, envLabels)
    //Apply labels to the list itself
    client.util.label(result, allLabels)

    result.items.forEach((item)=>{
      if (client.util.getLabel(item, 'shared') === 'true'){
        client.util.label(item, commonLabels)
      }else{
        client.util.label(item, allLabels)
      }
    })
    return result
  }
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
  client['_ocSpawnAndWait'] = _ocSpawnAndWait(client)
  client['_ocSpawnSync'] = _ocSpawnSync(client)
  //client['_raw'] = _oc(client)
  //client['process'] = ocProcess(client)
  //client['apply'] = ocApply(client)
  //client['prepare'] = prepare(client)
  client['logsToFileSync'] = ocLogsToFileSync(client)
  client['setBasicLabels'] = setBasicLabels(client)

  const argv= process.argv.slice(2)
  for (let j = 0; j < argv.length; j++) {  
    var item=argv[j]
    if (item.startsWith('--')){
      var marker=item.indexOf('=')
      if (marker>0){
        var key = item.substring(2, marker)
        var value = item.substring(marker+1)
        settings[key]=value
      }
    }
  }

  
  
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
