const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const expect = require('expect.js');

var mockSpawn = require('mock-spawn');
var mySpawn = mockSpawn();
var mockSpawnSync = (command, args)=>{
  console.log(`command:${command}`)
  console.log(`args:${args}`)
  return {status:0}
}

//require('child_process').spawnSync = mockSpawnSync;
var originalSpawn =require('child_process').spawn;
//require('child_process').spawn = mySpawn;

function hashObject(resource){
  var shasum = crypto.createHash('sha1');
  var itemAsString = JSON.stringify(resource)
  shasum.update(itemAsString);
  return shasum.digest('hex');
}

mySpawn.setStrategy(function (command, args, opts) {
  console.log(`command:${command}`)
  console.log(`args:${args.join(' ')}`)
  console.log(`opts:${opts}`)

  return function (cb) {
    if (args.indexOf("process")){

    }
    var hash = hashObject({'command':command, 'args':args}) 
    var json = require(`./mocks/${hash}.json`); //(with path)
    this.stdout.write(json);
    return cb(0); // and exit 0
  };
});

const cli=require('./main')

const buildConfigs=[{
  'filename':'.pipeline/_python36.bc.json',
  'param':[
    'NAME=hello',
    'SUFFIX=-prod',
    'VERSION=1.0.0',
    'SOURCE_BASE_CONTEXT_DIR=app-base',
    'SOURCE_CONTEXT_DIR=app',
    'SOURCE_REPOSITORY_URL=https://github.com/cvarjao-o/hello-world.git',
    'SOURCE_REPOSITORY_REF=master'
  ]
}]


var log4js = require('log4js');
log4js.configure({
  appenders: {
    console: { type: 'console' }
  },
  categories: {
    default: { appenders: ['console'], level: 'trace' }
  }
});

var logger = log4js.getLogger();

function save(object){
  var hash= hashObject(object)
  logger.info(`Writing output to ./src/mocks/${hash}.json`)
  if (!fs.existsSync('./state')){
    fs.mkdirSync('./state')
  }  
  fs.writeFileSync(`./state/${hash}.json`, JSON.stringify(object))
}

function restore(hash){
  var content = fs.readFileSync(`./state/${hash}.json`);
  return JSON.parse(content);
}

describe('Array', function() {
  describe('#indexOf()', function() {
    const oc=cli({'options':{'namespace':'csnr-devops-lab-tools'}, 'cwd':'/Users/cvarjao/Documents/GitHub/cvarjao-o/hello-world'});

    before(function() {

    })
    after(function() {

    })
    it.skip('process/prepare/apply', function() {
      this.timeout(20000);
      return oc.process(buildConfigs)
      .then((result) =>{
        return oc.prepare(result)}
      )
      .then((result)=>{
        save(result)
        return oc.apply({'filename':result, 'dry-run':'true'});
      })
      .then((result)=>{
        expect(result.length).to.equal(5);
      })
    });

    it('startBuilds', function() {
      return new Promise(function(resolve, reject) {
        resolve(restore('da2af20802a197321ba64a71e97915327d7826b1'))
      }).then(result => {
        return oc.startBuilds(result.items)
      }).then(result  => {
        console.dir(result)
        expect(result.length).to.equal(2);
      })
    })
  });
});
