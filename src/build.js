'use strict';
const log4js = require('log4js');
const logger = log4js.getLogger('oc-helper/build');

const {spawn, spawnSync} = require('child_process');
const path = require('path');
//const crypto = require('crypto')
const fs = require('fs');

const util = require('./util.js');
const fullName = util.fullName;
const shortName = util.shortName;
const CONSTANTS = util.CONSTANTS;
const asArray = util.asArray;
const cache = new Map()

function getBuildStatus (client, buildCacheEntry) {
  if (!buildCacheEntry || !buildCacheEntry.item){
    return undefined;
  }
  return cache.get(fullName(buildCacheEntry.item))
}

function _hashDirectory (dir) {
  var result= []
  var items=fs.readdirSync(dir).sort()

  logger.trace('items:', items)
  items.forEach( item => {
    var fullpath=path.join(dir, item)
    var stat=fs.statSync(fullpath)
    if (stat.isDirectory()){
      result.push(..._hashDirectory(fullpath))
    }else{
      result.push(util.hashString(fs.readFileSync(fullpath)))
    }
  })
  return result
}

function hashDirectory (dir) {
  var items=_hashDirectory(dir);
  return util.hashObject(items)
}

function _startBuild (client, buildConfig) {
  //return (builds) => {
    return new Promise(function(resolve, reject){
      //ToDo:CHeck if it needs new build
      const LOG = log4js.getLogger(`oc-helper/build/${fullName(buildConfig)}`)
      const tmpfile=`/tmp/${util.hashObject(buildConfig)}.tar`
      let args={}
      const hashData = {source:buildConfig.metadata.labels[CONSTANTS.LABELS.SOURCE_HASH], images:[], buildConfig:buildConfig.metadata.labels[CONSTANTS.LABELS.TEMPLATE_HASH]}
      var contextDir=buildConfig.spec.source.contextDir
      LOG.trace(`${fullName(buildConfig)}.metadata.labels`,buildConfig.metadata.labels)
      LOG.trace(`${fullName(buildConfig)}.metadata.annotations`,buildConfig.metadata.annotations)

      if (buildConfig.spec.source.type == 'Binary'){
        if (fs.existsSync(tmpfile)){fs.unlinkSync(tmpfile)}
        spawnSync('tar', ['-chf', tmpfile, buildConfig.spec.source.contextDir], {'cwd':client.settings.cwd})
        args={'from-build-config':  shortName(buildConfig), 'from-archive':  tmpfile, 'wait':'true'}
        hashData.source=hashDirectory(path.join(client.settings.cwd, contextDir));
      }else{
        args={'from-build-config':  shortName(buildConfig), 'wait':'true'}
        hashData.source=spawnSync('git', ['rev-parse', `HEAD:${contextDir}`], {'cwd':client.settings.cwd, encoding:'utf-8'}).stdout.trim()
      }
      getBuildConfigInputImages(buildConfig).forEach(sourceImage => {
        if (sourceImage.kind === CONSTANTS.KINDS.IMAGE_STREAM_TAG){
          var ocGet = spawnSync('oc', asArray(client.settings.options).concat(['get', `${sourceImage.kind}/${sourceImage.name}`, '--output=jsonpath={.image.metadata.name}']), {'cwd':client.settings.cwd, encoding:'utf-8'});
          var imageName = ocGet.stdout.trim()
          var imageStreamImageName = sourceImage.name.split(':')[0] + '@' + imageName
          LOG.info(`Rewriting reference from '${sourceImage.kind}/${sourceImage.name}' to '${CONSTANTS.KINDS.IMAGE_STREAM_IMAGE}/${imageStreamImageName}'`)
          sourceImage.kind = CONSTANTS.KINDS.IMAGE_STREAM_IMAGE
          sourceImage.name = imageStreamImageName
        }
        hashData.images.push(sourceImage)
      })
      var env = {}
      const buildHash = util.hashObject(hashData)
      LOG.trace(`${fullName(buildConfig)} > hashData`,hashData)


      env[CONSTANTS.ENV.BUILD_HASH] = buildHash
      setBuildEnv(buildConfig, env)
      LOG.trace(`${fullName(buildConfig)} > .spec.strategy..env`, getBuildConfigStrategySpec(buildConfig).env)
      //Looking for an existing image with the same build hash
      var outputTo = buildConfig.spec.output.to
      if (outputTo.kind !== CONSTANTS.KINDS.IMAGE_STREAM_TAG){
        throw `Expected kind=${CONSTANTS.KINDS.IMAGE_STREAM_TAG}, but found kind=${outputTo.kind} for ${fullName(buildConfig)}.spec.output.to`
      }
      
      var ocGetOutputImageStream = client.getSync({'resource':`${CONSTANTS.KINDS.IMAGE_STREAM}/${outputTo.name.split(':')[0]}`});
      var images = JSON.parse(ocGetOutputImageStream).status.tags
      var foundImageStreamImage = null
      var foundBuild = null

      images.forEach(tag => {
        if (!foundImageStreamImage){
          tag.items.forEach(image => {
            if (!foundImageStreamImage){
              var ocImageStreamImage = JSON.parse(spawnSync('oc', asArray(client.settings.options).concat(['get', `${CONSTANTS.KINDS.IMAGE_STREAM_IMAGE}/${outputTo.name.split(':')[0]}@${image.image}`, '--output=json']), {'cwd':client.settings.cwd, encoding:'utf-8'}).stdout.trim());
              var sourceBuild = {kind:CONSTANTS.KINDS.BUILD, metadata:{}}
              ocImageStreamImage.image.dockerImageMetadata.Config.Env.forEach((envLine => {
                //if (!foundImageStreamImage){
                  if (envLine === `${CONSTANTS.ENV.BUILD_HASH}=${buildHash}`){
                    foundImageStreamImage = ocImageStreamImage
                    foundBuild=sourceBuild
                  }else if (envLine.startsWith('OPENSHIFT_BUILD_NAME=')){
                    sourceBuild.metadata.name=envLine.split('=')[1]
                  }else if (envLine.startsWith('OPENSHIFT_BUILD_NAMESPACE=')){
                    sourceBuild.metadata.namespace=envLine.split('=')[1]
                  }
                //}
              }))

            }
          })
        }
      })

      const output = {
        buildConfig:{
          kind:buildConfig.kind, 
          metadata:{
            name:buildConfig.metadata.name,
            namespace:buildConfig.metadata.namespace
          },
          spec:{
            output:buildConfig.spec.output
          }
        },
        imageStreamTag:{
          kind:buildConfig.spec.output.to.kind,
          metadata:{
            name:buildConfig.spec.output.to.name,
            namespace:buildConfig.spec.output.to.namespace || buildConfig.metadata.namespace
          },
        }
      }

      if (foundImageStreamImage){
        const entry={item:foundImageStreamImage}
        cache.get(fullName(buildConfig)).imageStreamImageEntry = entry
        cache.set(fullName(foundImageStreamImage), entry)
        output.build=foundBuild
        output.newBuild = false
        output.imageStreamImage={
          kind:foundImageStreamImage.kind,
          metadata:{
            name:foundImageStreamImage.metadata.name,
            namespace:foundImageStreamImage.metadata.namespace
          }
        }
        LOG.info(`Reusing '${fullName(output.imageStreamImage)}' created by '${fullName(output.build)}'`)
        resolve(output)
      }else{
        client.apply({filename:{kind:CONSTANTS.KINDS.LIST, items:[buildConfig]}}).then(() => {
          return client.startBuild(args)
        }).then(build =>{
          //setTimeout(function(){
            if (fs.existsSync(tmpfile)){fs.unlinkSync(tmpfile)}
            const entry={item:build}
            cache.get(fullName(buildConfig)).buildEntry = entry
            cache.set(fullName(build), entry)
            
            //logger.info(`Finished ${fullName(build)}`)

            output.build = {
              kind:build.kind,
              metadata:{
                name:build.metadata.name,
                namespace:build.metadata.namespace,
                annotations:{
                  'openshift.io/build-config.name':build.annotations['openshift.io/build-config.name'],
                  'openshift.io/build.number':build.annotations['openshift.io/build.number'],
                  'openshift.io/build.pod-name':build.annotations['openshift.io/build.pod-name']
                }
              }
            }
            output.newBuild = true
            output.imageStreamImage={
              kind:CONSTANTS.KINDS.IMAGE_STREAM_IMAGE,
              metadata:{
                name:`${build.spec.output.to.name.split(':')[0]}@${build.status.output.to.imageDigest}`,
                namespace:build.spec.output.to.namespace || build.metadata.namespace
              }
            }
            LOG.info(`Created '${fullName(output.imageStreamImage)}' using '${fullName(output.build)}'`)
            resolve(output);
          //}, 3000);
        })
      }

    });
  //}
}

function pickNextBuilds (client, builds, buildConfigs) {
  //var buildConfigs = _buildConfigs.slice()
  //const maxLoopCount = buildConfigs.length * 2
  var currentBuildConfigEntry = null
  //var currentLoopCount = 0
  var promises = []

  var head = undefined
  logger.trace(`>pickNextBuilds from ${buildConfigs.length} buildConfigs`)
  while((currentBuildConfigEntry=buildConfigs.shift()) !== undefined){
    if (head === undefined) {
      head = currentBuildConfigEntry
    }else if( head === currentBuildConfigEntry){
      buildConfigs.push(currentBuildConfigEntry)
      break;
    }

    const currentBuildConfig = currentBuildConfigEntry.item;
    const buildConfigFullName = fullName(currentBuildConfig)
    const dependencies= currentBuildConfigEntry.dependencies
    var resolved=true

    //logger.trace(`Trying to queue ${buildConfigFullName}`)

    for (var i = 0; i < dependencies.length; i++) {
      var parentBuildConfigEntry = dependencies[i].buildConfigEntry
      logger.trace(`${buildConfigFullName}  needs ${fullName(dependencies[i].item)}`)
      if (parentBuildConfigEntry){
        logger.trace(`${buildConfigFullName}  needs ${fullName(parentBuildConfigEntry.item)}`)
        //var parentBuildConfig = parentBuildConfigEntry.item
        if (!parentBuildConfigEntry.imageStreamImageEntry){
          var parentBuildEntry = parentBuildConfigEntry.buildEntry
          var buildStatus = getBuildStatus(client, parentBuildEntry)
          if (buildStatus === undefined){
            resolved =false
            break;
          }
        }
      }
    }

    //dependencies have been resolved/satisfied
    if (resolved){
      logger.trace(`Queuing ${buildConfigFullName}`)
      promises.push(_startBuild(client, currentBuildConfig).then( build => {
        if (build!=null){
          builds.push(build);
        }
      }))

      if( head === currentBuildConfigEntry){
        head = undefined
      }
    }else{
      buildConfigs.push(currentBuildConfigEntry)
      logger.trace(`Delaying ${buildConfigFullName}`)
      //logger.trace(`buildConfigs.length =  ${buildConfigs.length}`)
    }
  } // end while

  var p = Promise.all(promises)
  //logger.trace(`buildConfigs.length =  ${buildConfigs.length}`)
  if (buildConfigs.length > 0){
    p=p.then(function() {
      return pickNextBuilds(client, builds, buildConfigs)
    });
  }
  return p;
}

function setBuildEnv (bc, newEnv) {
  var buildStrategy = getBuildConfigStrategySpec(bc);
  var current = {}
  if (buildStrategy.env){
    buildStrategy.env.forEach(item =>{
      current[item.name] = item.value
    })
  }
  for (var prop in newEnv) {
    if(!newEnv.hasOwnProperty(prop)) continue;
    current[prop]= newEnv[prop]
  }
  buildStrategy.env = []
  for (var prop in current) {
    if(!current.hasOwnProperty(prop)) continue;
    buildStrategy.env.push({name:prop, value:current[prop]})
  }
}

function getBuildConfigStrategySpec(bc){
  return bc.spec.strategy.sourceStrategy || bc.spec.strategy.dockerStrategy
}

function getBuildConfigInputImages (bc) {
  var result = []
  var buildStrategy = bc.spec.strategy.sourceStrategy || bc.spec.strategy.dockerStrategy

  if (buildStrategy.from){
    result.push(buildStrategy.from)
  }

  if ((bc.spec.source || {}).images){
    var sourceImages= bc.spec.source.images
    sourceImages.forEach( sourceImage  => {
        result.push(sourceImage)
    })
  }

  return result
}

function startBuilds (client) {
  return (resources) => {
    logger.trace('>startBuilds')
    //var cache = new Map()

    var buildConfigs = []
    resources.forEach((res)=>{
      var resourceFullName=fullName(res)
      var entry = {item:res, fullName:resourceFullName}

      logger.trace(`Indexing ${resourceFullName} - ${res.metadata.namespace}`)
      //keys[resourceFullName] = Symbol(resourceFullName)
      cache.set(resourceFullName, entry)
      if (res.kind == CONSTANTS.KINDS.BUILD_CONFIG){
        buildConfigs.push(entry)
      }
    })

    buildConfigs.forEach((entry)=>{
      var bc = entry.item
      var buildConfigFullName = fullName(bc)
      logger.trace(`Analyzing ${buildConfigFullName} - ${bc.metadata.namespace}`)
      var outputTo = bc.spec.output.to
      if (outputTo){
        if (outputTo.kind === CONSTANTS.KINDS.IMAGE_STREAM_TAG){
          var name=outputTo.name.split(':')
          var imageStreamFullName = `${CONSTANTS.KINDS.IMAGE_STREAM}/${name[0]}`
          var imageStreamCacheEntry = cache.get(imageStreamFullName)
          imageStreamCacheEntry.buildConfigEntry = entry
          //indexOfBuildConfigByOutputImageStream.set(imageStreamFullName, bc)
        }else{
          die(`Expected '${CONSTANTS.KINDS.IMAGE_STREAM_TAG}' but found '${outputTo.kind}' in ${buildConfigFullName}.spec.output.to`)
        }
        
      }
      var buildStrategy = bc.spec.strategy.sourceStrategy || bc.spec.strategy.dockerStrategy

      var dependencies = []

      getBuildConfigInputImages(bc).forEach(sourceImage => {
        if (sourceImage.kind === CONSTANTS.KINDS.IMAGE_STREAM_TAG){
          var name=sourceImage.name.split(':')
          var imageStreamFullName = `${CONSTANTS.KINDS.IMAGE_STREAM}/${name[0]}`
          dependencies.push(cache.get(imageStreamFullName))
        }else{
          die(`Expected '${CONSTANTS.KINDS.IMAGE_STREAM_TAG}' but found '${sourceImage.kind}' in ${fullName(buildConfigFullName)}`)
        }
      })
      entry.dependencies= dependencies
    })
    
    const builds= []
    return pickNextBuilds(client, builds, buildConfigs).then(()=>{
      return builds;
    })
  };
}

/**
 * Wraper for `oc start-build`
 */
function startBuild (client) {
  return function create (args = []) {
    args=asArray(args)
    for(var i=0; i< args.length; i++){
      if (args[i].startsWith('--from-build-config=')){
        args[i]=args[i].substr('--from-build-config='.length)
      }
    }
    const _args=['start-build', '--output=name'].concat(args)
    logger.info('Starting new build ',  ['oc'].concat(_args).join(' '))
    return client._raw(_args)
    .then((result)=>{
      //json output is in stream format
      var items=result.stdout.trim().split(/\n/);
      /*
      items.forEach((value, index)=>{
        items[index]=JSON.parse(value)
      });
      */
      //require('fs').writeFile('_oc_apply_stdout.json', result.stdout, 'utf8')
      return items[0]; //JSON.parse(result.stdout)
    }).then( (result) => {
      return client._raw(['get', `${result}`, '--output=json', '--export=true'])
      .then(result => {
        return JSON.parse(result.stdout.trim())
      })
    })
  };
}

module.exports = exports = {
  startBuild: startBuild,
  startBuilds: startBuilds
}