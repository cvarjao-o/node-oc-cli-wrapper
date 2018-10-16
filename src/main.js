'use strict';
const log4js = require('@log4js-node/log4js-api');
const logger = log4js.getLogger('node-oc-cli-wrapper');
const {spawn, spawnSync} = require('child_process');
const path = require('path');
const crypto = require('crypto')
const fs = require('fs');

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
      logger.trace(`oc ${_args.join(' ')}`)
      const _options = {cwd:client.settings.cwd};
      logger.trace(`cwd: ${_options.cwd}`)

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

function ocApply (client) {
  return function create (args = []) {
    var stdin=null;
    var items=null;
    var tmpfile=null;
    if (!(args instanceof Array)) {
      //logger.trace('!args instanceof Array')
      if (!(args['filename'] instanceof String)){
        //logger.trace('!args["filename"] instanceof String')
        items=args['filename']
        var json=JSON.stringify(items);
        var jsonHash=gitHashString(json);
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
        if (index == 0 ) {
          value += '}'
        }else if (index == items.length - 1 ) {
          value = '{' + value
        }else{
          value = '{' + value + '}'
        }
        //logger.trace(`[${index}]=${value}`)
        items[index]=JSON.parse(value)
      });
      //require('fs').writeFile('_oc_apply_stdout.json', result.stdout, 'utf8')
      return items; //JSON.parse(result.stdout)
    });
  };
}
const CONSTANTS = Object.freeze({
  KINDS: {
    LIST: 'List',
    BUILD_CONFIG: 'BuildConfig',
    IMAGE_STREAM: 'ImageStream',
    IMAGE_STREAM_TAG: 'ImageStreamTag'
  },
  ANNOTATIONS: {
    TEMPLATE_HASH: 'config-hash',
    SOURCE_HASH: 'source-hash'
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
    resource.metadata.labels[CONSTANTS.ANNOTATIONS.TEMPLATE_HASH] = gitHashObject(resource)
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
        sourceHash = gitHashObject(hashes)
      }

      //logger.trace(`sourceHash:${sourceHash} (${contextDir})`)
      resource.metadata.labels[CONSTANTS.ANNOTATIONS.SOURCE_HASH] = sourceHash;
    }
  }
}

function shortName (resource) {
  return resource.metadata.name
}

function fullName (resource) {
  return resource.kind + '/' + resource.metadata.name
}

function startBuild (client) {
  return (resource) => {
    return new Promise((resolve, reject) => {
      resolve({'kind':'Build', 'metadata':{'name':`${resource.metadata.name}-00`}})
    })
  }
}

function _startBuild (client, buildConfig) {
  return (builds) => {
    return new Promise(function(resolve, reject){
      client.startBuild(buildConfig).then(build =>{
        builds.push(build)
        resolve(builds)
      })
    });
  }
}

function _buildNext (client, currentBuildConfig, buidlConfigs, indexOfPromissesByBuildConfig, indexOfBuildConfigDependencies, indexOfBuildConfigByOutputImageStream) {


  return new Promise(function(resolve, reject){
    var buildConfigFullName = fullName(currentBuildConfig);

  })

  const maxLoopCount = buildConfigs.length * 2
  var currentBuildConfig = null
  var currentLoopCount = 0

  while((currentBuildConfig=buildConfigs.shift()) !== undefined){
    var buildConfigFullName = fullName(currentBuildConfig)
    var dependencies= indexOfBuildConfigDependencies.get(buildConfigFullName)
    var resolved=true

    logger.trace(`Trying to queue ${buildConfigFullName}`)

    for (var i = 0; i < dependencies.length; i++) {
      var imageStreamName=dependencies[i]
      var parentBuildConfig = indexOfBuildConfigByOutputImageStream.get(imageStreamName)
      if (parentBuildConfig !== undefined){
        if (!indexOfPromissesByBuildConfig.has(parentBuildConfig)){
          logger.trace(`Waiting for ${fullName(parentBuildConfig)}`)
          resolved = false
          break;
        }
      }
    }
    //analize

    //return to list, try again later
    if (!resolved){
      buildConfigs.push(currentBuildConfig)
    }else{
      var _callStartBuild = function(builds) {
        var promise = new Promise(function(resolve, reject){
          logger.trace(`Starting ${buildConfigFullName}`)
           resolve(builds)
        });

        return promise;
     };

     logger.trace(`Queuing ${buildConfigFullName}`)
     p=p.then(_startBuild(client, currentBuildConfig))

      indexOfPromissesByBuildConfig.set(currentBuildConfig, p)
    }

    currentLoopCount++
    if (currentLoopCount > maxLoopCount){
      throw `It seems like there is a circular reference among BuildConfigs and their ImageStreams: ${buildConfigs}`
    }
  } // end while
}
function startBuilds (client) {
  return (resources) => {
    logger.trace('>startBuilds')
    var promises = [];
    //var keys = {}
    var indexOfAllByName = new Map()
    var indexOfBuildConfigByOutputImageStream = new Map()
    var indexOfBuildConfigByInputImageStream = new Map()
    var indexOfBuildConfigDependencies = new Map()
    var indexOfBuildConfigBuild = new Map()
    var indexOfPromissesByBuildConfig = new Map()

    var buildConfigs = []
    resources.forEach((res)=>{
      var resourceFullName=fullName(res)
      logger.trace(`Indexing ${resourceFullName} - ${res.metadata.namespace}`)
      //keys[resourceFullName] = Symbol(resourceFullName)
      indexOfAllByName.set(resourceFullName, res)
      if (res.kind == CONSTANTS.KINDS.BUILD_CONFIG){
        buildConfigs.push(res)
      }
    })

    buildConfigs.forEach((bc)=>{
      var buildConfigFullName = fullName(bc)
      logger.trace(`Analyzing ${buildConfigFullName} - ${bc.metadata.namespace}`)
      var outputTo = bc.spec.output.to
      if (outputTo){
        if (outputTo.kind === CONSTANTS.KINDS.IMAGE_STREAM_TAG){
          var name=outputTo.name.split(':')
          var imageStreamFullName = `${CONSTANTS.KINDS.IMAGE_STREAM}/${name[0]}`
          indexOfBuildConfigByOutputImageStream.set(imageStreamFullName, bc)
        }else{
          die(`Expected '${CONSTANTS.KINDS.IMAGE_STREAM_TAG}' but found '${outputTo.kind}' in ${buildConfigFullName}.spec.output.to`)
        }
        
      }
      var buildStrategy = bc.spec.strategy.sourceStrategy || bc.spec.strategy.dockerStrategy

      var dependencies = []
      if (buildStrategy.from){
        logger.trace(`${buildConfigFullName} - `, buildStrategy.from)
        if (buildStrategy.from.kind === CONSTANTS.KINDS.IMAGE_STREAM_TAG){
          var name=buildStrategy.from.name.split(':')
          var imageStreamFullName = `${CONSTANTS.KINDS.IMAGE_STREAM}/${name[0]}`
          indexOfBuildConfigByInputImageStream.set(imageStreamFullName, bc)
          dependencies.push(imageStreamFullName)
        }else{
          die(`Expected '${CONSTANTS.KINDS.IMAGE_STREAM_TAG}' but found '${buildStrategy.from.kind}' in ${buildConfigFullName}.strategy.*.from`)
        }
      }

      if ((bc.spec.source || {}).images){
        var sourceImages= bc.spec.source.images
        sourceImages.forEach( sourceImage  => {
          if (sourceImage.kind === CONSTANTS.KINDS.IMAGE_STREAM_TAG){
            var name=sourceImage.name.split(':')
            var imageStreamFullName = `${CONSTANTS.KINDS.IMAGE_STREAM}/${name[0]}`
            dependencies.push(imageStreamFullName)
          }
        })
      }
      indexOfBuildConfigDependencies.set(buildConfigFullName, dependencies)
    })

    const maxLoopCount = buildConfigs.length * 2
    var p = Promise.resolve([])
    var currentBuildConfig = null
    var currentLoopCount = 0

    while((currentBuildConfig=buildConfigs.shift()) !== undefined){
      var buildConfigFullName = fullName(currentBuildConfig)
      var dependencies= indexOfBuildConfigDependencies.get(buildConfigFullName)
      var resolved=true

      logger.trace(`Trying to queue ${buildConfigFullName}`)

      for (var i = 0; i < dependencies.length; i++) {
        var imageStreamName=dependencies[i]
        var parentBuildConfig = indexOfBuildConfigByOutputImageStream.get(imageStreamName)
        if (parentBuildConfig !== undefined){
          if (!indexOfPromissesByBuildConfig.has(parentBuildConfig)){
            logger.trace(`Waiting for ${fullName(parentBuildConfig)}`)
            resolved = false
            break;
          }
        }
      }
      //analize

      //return to list, try again later
      if (!resolved){
        buildConfigs.push(currentBuildConfig)
      }else{
        var _callStartBuild = function(builds) {
          var promise = new Promise(function(resolve, reject){
            logger.trace(`Starting ${buildConfigFullName}`)
             resolve(builds)
          });

          return promise;
       };

       logger.trace(`Queuing ${buildConfigFullName}`)
       p=p.then(_startBuild(client, currentBuildConfig))

        indexOfPromissesByBuildConfig.set(currentBuildConfig, p)
      }

      currentLoopCount++
      if (currentLoopCount > maxLoopCount){
        throw `It seems like there is a circular reference among BuildConfigs and their ImageStreams: ${buildConfigs}`
      }
    } // end while

    //Index BuildConfigs and ImageStreams
    //Ordering of BuildConfigs
    return p;
  };
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

  client['settings']=settings || {}  
  client['_raw'] = _oc(client)
  client['process'] = ocProcess(client)
  client['apply'] = ocApply(client)
  client['prepare'] = prepare(client)
  client['startBuild'] = startBuild(client)
  client['startBuilds'] = startBuilds(client)
  return client;
}

module.exports = exports = openShiftClient;
