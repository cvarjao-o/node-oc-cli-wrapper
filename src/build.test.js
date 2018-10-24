const assert = require('assert');
const fs = require('fs');
const expect = require('expect.js');
const util=require('./util')
require('./configure-logging.js')()


const cli=require('./main')
var logger = util.getLogger();

const buildConfigs=[{
  'filename':'openshift/_python36.bc.json',
  'param':{
    'NAME':'hello',
    'SUFFIX':'-prod',
    'VERSION':'build-1.0.0',
    'SOURCE_BASE_CONTEXT_DIR':'app-base',
    'SOURCE_CONTEXT_DIR':'app',
    'SOURCE_REPOSITORY_URL':'https://github.com/cvarjao-o/hello-world.git',
    'SOURCE_REPOSITORY_REF':'master'
  }
}]

function save(object){
  var hash= util.hashObject(object)
  logger.info(`Writing output to ./src/mocks/${hash}.json`)
  if (!fs.existsSync('./state')){
    fs.mkdirSync('./state')
  }
  var filepath = `./state/${hash}.json`;
  if (fs.existsSync(filepath)){
    fs.unlinkSync(filepath)
  }
  fs.writeFileSync(filepath, JSON.stringify(object))
  return hash
}

function restore(hash){
  var content = fs.readFileSync(`./state/${hash}.json`);
  return JSON.parse(content);
}

logger.trace("Starting")
//describe('oc', function() {
  describe('build', function() {
    const oc=cli({'options':{'namespace':'csnr-devops-lab-tools'}, 'cwd':'/Users/cvarjao/Documents/GitHub/cvarjao-o/hello-world'});

    //before(function() { })
    //after(function() { })
    const cache = new Map()
    this.timeout(40000);

    it('process/prepare', function() {  
      return oc.process(buildConfigs)
      .then((result) =>{
        return oc.prepare(result)
      })
      .then((result)=>{
        expect(result.kind).to.equal('List');
        expect(result.items.length).to.equal(5);
        return result
      })
      .then((result)=>{
        oc.setBasicLabels(result, 'hello', 'build', 'pr-1')
        cache.set('prepared-state', save(result))
        return result;
      })
    });

    it('apply', function() {
      return new Promise(function(resolve, reject) {
        resolve(restore(cache.get('prepared-state')))
      }).then(result => {
        return oc.apply(result);
      }).then(result  => {
        expect(result.length).to.equal(5);
      })
    });

    it('startBuilds', function() {
      return new Promise(function(resolve, reject) {
        resolve(restore(cache.get('prepared-state')))
      }).then(result => {
        expect(result).to.have.property('items')
        expect(result).to.have.property('kind')
        expect(result.kind).to.equal('List');
        return oc.startBuilds(result.items)
      }).then(result  => {
        oc.saveBuildArtifactsToDir(result, './output')
        
        //console.dir(result)
        expect(result).to.be.an('array')
        expect(result.length).to.equal(2);

        result.forEach(function(item){
          expect(item).to.have.property('buildConfig')
          expect(item).to.have.property('build')
          expect(item).to.have.property('imageStreamTag')
          expect(item).to.have.property('imageStreamImage')
        })
      })
    });
  });
//});
