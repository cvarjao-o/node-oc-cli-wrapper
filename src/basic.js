'use strict';
/**
* @module oc
*/

const fs = require('fs');

module.exports = exports = {
  fetchResourceVersion: function (client) {
    return (list) => {
      return new Promise(async (resolve, reject) => {
        if (list.kind !== 'List') throw "Expected {kind:'List'}"
        var items = []
        var index = new Map()
        list.items.forEach (item  => {
          items.push(`${item.kind}/${item.metadata.name}`)
          index.set(`${item.kind}/${item.metadata.name}`, item)
        })

        var exitingItems = await client.get(items, {'ignore-not-found':'true'})
        if (exitingItems!=null){
          if (exitingItems.kind != 'List') exitingItems= {'kind':'List', items:[exitingItems]}
          exitingItems.items.forEach (item  => {
            var newItem = index.get(`${item.kind}/${item.metadata.name}`)
            newItem.metadata.resourceVersion = item.metadata.resourceVersion
          })
        }
        return resolve(list);
      });
    };
  },
  prepare: function (client) {
    return (list) => {
      return new Promise(async (resolve, reject) => {
        if (list.kind !== 'List') throw "Expected {kind:'List'}"
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
  },
  importImageStreams: function (client) {
    return (list, targetImageTag, sourceNamespace, sourceImageTag) => {
      return new Promise(async (resolve, reject) => {
        if (list.kind !== 'List') throw "Expected {kind:'List'}"
  
        for (var i = 0; i < list.items.length; i++) {
          var item = list.items[i]
          if (item.kind === 'ImageStream'){
            //
            var dockerImageReference1 = await client._ocSpawnAndReturnStdout('get', {'resource':`${client.util.CONSTANTS.KINDS.IMAGE_STREAM_TAG}/${item.metadata.name}:${sourceImageTag}`, 'output':'jsonpath={.image.dockerImageReference}', 'namespace':sourceNamespace});
            var dockerImageName = dockerImageReference1.stdout.split('@')[1]
            await client._ocSpawnAndWait('import-image', {resources:`${item.metadata.name}:temp1-${targetImageTag}`, 'from':dockerImageReference1.stdout, 'confirm':'true', 'insecure':'true'})
            var dockerImageRepository = await client._ocSpawnAndReturnStdout('get', {'resource':`${client.util.CONSTANTS.KINDS.IMAGE_STREAM}/${item.metadata.name}`, 'output':'jsonpath={.status.dockerImageRepository}'});
            await client._ocSpawnAndWait('import-image', {resources:`${item.metadata.name}:temp2-${targetImageTag}`, 'from':`${dockerImageRepository.stdout}@${dockerImageName}`, 'confirm':'true', 'insecure':'true'})
            await client._ocSpawnAndWait('tag', {resources:[`${item.metadata.name}@${dockerImageName}`,`${item.metadata.name}:${targetImageTag}`]})
            await client._ocSpawnAndWait('tag', {resources:`${item.metadata.name}:temp1-${targetImageTag}`, 'delete':'true'})
            await client._ocSpawnAndWait('tag', {resources:`${item.metadata.name}:temp2-${targetImageTag}`, 'delete':'true'})
            //console.dir(item)
          }
        }
        return resolve(list);
      });
    };
  },
  process: function (client) {
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
  },
  'fetchSecretsAndConfigMaps':function (client) {
    return async function (resources, args = {}) {
      if ((resources != null) && resources.kind == null) throw "Expected an OpenShift object with a 'kind' property"
      for (var i = 0; i < resources.items.length; i++) {
        var resource=resources.items[i]
        if (resource.kind === "Secret" || resource.kind === "ConfigMap"){
          var refName=client.util.getAnnotation(resource, "as-copy-of")
          if (refName!=null){
            const refResource= await client.get(`${resource.kind}/${refName}`)
            resource.data =  refResource.data
            const tmpStringData=resource.stringData
            resource.stringData = {}
            if (resource.kind === "Secret" && tmpStringData['metadata.name']){
              resource.stringData['metadata.name'] = resource.metadata.name
            }
            var preserveFields = client.util.getAnnotation(resource, "as-copy-of/preserve");
            if (resource.kind === "Secret"  && preserveFields){
              const refResource= await client.get(`${resource.kind}/${resource.metadata.name}`, {'ignore-not-found':'true'})
              resource.data[preserveFields] = refResource.data[preserveFields]
            }
          }
        }else if (resource.kind === "Route"){
          var refName=client.util.getAnnotation(resource, "tls/secretName")
          if (refName!=null){
            const refResource= await client.get(`${resource.kind}/${refName}`)
            const refData = refResource.data
            for (var prop in refData) {
              if(!refData.hasOwnProperty(prop)) continue;
              refData[prop] = Buffer.from(refData[prop], 'base64').toString('ascii')
            }
            resource.spec.tls = resource.spec.tls || {}
            Object.assign(resource.spec.tls, refData)
          }
        }
      }
      return resources
    }
  },
  'apply':function (client) {
    /** Helper for `oc apply`
     * @member apply
     * @function
     * @param resources {Object}
     * @param args {Object}
     * @returns {Promise} Array of resources created or updated
     * @see https://www.mankier.com/1/oc-apply
     */
    return async function (resources, args = {}) {
      if ((resources != null) && resources.kind == null) throw "Expected an OpenShift object with a 'kind' property"
      if ((resources == null) && args['filename'] == null) throw "Expected a 'resources' or 'args.filename' property to be defined"

      var items=null;
      var tmpfile=null;
      var _args = args

      if (resources != null){
        await client.fetchResourceVersion(resources)
        _args['filename']=resources
      }

      //if (!(_args instanceof Array)) {
      //logger.trace('!args instanceof Array')
      if (!(_args['filename'] instanceof String || typeof _args['filename'] === 'string')){
        //logger.trace('!args["filename"] instanceof String')
        items=_args['filename']
        var json=JSON.stringify(items);
        var jsonHash=client.util.hashString(json);
        tmpfile=`/tmp/${jsonHash}.json`;

        fs.writeFileSync(tmpfile, json)
        _args['filename']=tmpfile
        //stdin=(stdin)=>{stdin.setEncoding('utf-8'); stdin.write(json); stdin.end();}
      }
      //}
  
      return client._ocSpawnAndReturnStdout('apply', Object.assign({output:'name'}, _args))
      .then((result)=>{
        fs.unlinkSync(tmpfile)
        return result
      })
      .then(async (result)=>{
        //json output is in stream format
        var items=result.stdout.trim().split(/\n/);
        var newResult = {}
        var outputItems = await client.get(items)
        if (resources != null && resources.kind == 'List'){
          delete outputItems.metadata
          Object.assign(newResult, resources)
          Object.assign(newResult, outputItems)
        }else{
          newResult = outputItems;
        }
        return newResult;
      });
  
    };
  },
  'applyAndWait':function (client) {
    return async function (resources) {
      const existingDC= await client._ocSpawnAndReturnStdout('get', {resource:'dc', 'selector':`app=${resources.metadata.labels['app']}`, output:'jsonpath={range .items[*]}{.metadata.name}{"\\t"}{.spec.replicas}{"\\t"}{.status.latestVersion}{"\\n"}{end}'})
      //
      return client.apply(resources).then(async result => {
        const newDCs = await client._ocSpawnAndReturnStdout('get', {resource:'dc', 'selector':`app=${resources.metadata.labels['app']}`, output:'jsonpath={range .items[*]}{.metadata.name}{"\\t"}{.spec.replicas}{"\\t"}{.status.latestVersion}{"\\n"}{end}'})
        if (existingDC.stdout != newDCs.stdout){
          //console.log("Something changed")
          return new Promise(async function(resolve, reject) {
            const pending = new Map()
            for (var i = 0; i < resources.items.length; i++) {
              var resource=resources.items[i]
              if (resource.kind ===  client.util.CONSTANTS.KINDS.DEPLOYMENT_CONFIG){
                pending.set(resource.metadata.name, true)
              }
            }
            var proc = await client._ocSpawn('get', {resource:'dc', 'selector':`app=${resources.metadata.labels['app']}`, 'watch':'true', output:'jsonpath={.metadata.name}{"\\t"}{.status.replicas}{"\\t"}{.status.availableReplicas}{"\\t"}{.status.unavailableReplicas}{"\\t"}{.status.latestVersion}{"\\n"}'})
            let stdout=''
            proc.stdout.on('data', async (data) => {
              stdout+=data
              var i =-1;
              while ((i = stdout.indexOf('\n'))>=0){
                var line =stdout.substring(0, i).replace(/(\s)+/g, "\t")
                stdout= stdout.substr(i+1)
                //console.log(`Processing '${line}'`)
                var args=line.split('\t')
                const dc = await client.get('get', {resource:`dc/${args[0]}`, output:'json'})
                if (dc.status.conditions){
                  for (var j = 0; j < dc.status.conditions.length; j++) {
                    var condition= dc.status.conditions[j];
                    if (condition.type == 'Available' && condition.status == 'True'){
                      if (dc.spec.replicas == dc.status.replicas && dc.status.readyReplicas == dc.spec.replicas && dc.status.availableReplicas == dc.spec.replicas && dc.status.unavailableReplicas == '0'){
                        pending.delete(dc.metadata.name)
                      }
                    }
                  }
                }
              }
              if (pending.size == 0){
                //console.log(`Nothing else to process`)
                proc.kill('SIGTERM')
              }
            })

            proc.on('exit', (code) => {
              resolve(result)
            })
          })
        }
        return result
      })
    }
  },
  'get':function (client) {
    /** Helper for `oc get`.
     * @member get
     * @function
     * @param resources {(Object|Array<Object>|string|Array<string>)}
     * @returns {Promise} Array of resources created or updated
     * @see https://www.mankier.com/1/oc-get
     */
    return function (resources, args = {}) {
      var _args = Object.assign({}, args) //creates a shallow copy
      return client._ocSpawnAndReturnStdout('get', Object.assign({resources:resources, output:'json'}, _args))
      .then(result => {
        var json = result.stdout.trim()
        if (json.length == 0){
          return null
        }
        return JSON.parse(json)
      })
    }
  }
}