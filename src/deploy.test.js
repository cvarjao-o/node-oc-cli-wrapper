const assert = require('assert');
const fs = require('fs');
const expect = require('expect.js');
const util=require('./util')
require('./configure-logging.js')()

const cli=require('./main')

var logger = util.getLogger();

const buildNamespace = 'csnr-devops-lab-tools'
const buildVersion = 'build-1.0.0'
const deploymentVersion = 'dev-1.0.0'

const deploymentConfigs=[{
  'filename':'openshift/_python36.dc.json',
  'param':{
    'NAME':'hello',
    'SUFFIX':'-dev',
    'VERSION':deploymentVersion,
    'HOST':''
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

//describe('oc', function() {
  describe('deployment', function() {
    this.timeout(400000);
    const oc=cli({'options':{'namespace':'csnr-devops-lab-deploy'}, 'cwd':'/Users/cvarjao/Documents/GitHub/cvarjao-o/hello-world'});

    //before(function() { })
    //after(function() { })
    const cache = new Map()

    it('process/prepare', function() {
      return oc.process(deploymentConfigs)
      .then((result) =>{
        return oc.prepare(result)}
      )
      .then((result)=>{
        oc.setBasicLabels(result, 'hello', 'dev', 'pr-1')
        cache.set('prepared-state', save(result))
        return result;
      })
      .then((result)=>{
        expect(result.kind).to.equal('List');
        expect(result.items.length).to.equal(5);
      })
    });

    it('apply', function() {
      return new Promise(function(resolve, reject) {
        resolve(restore(cache.get('prepared-state')))
      }).then(result => {
        return oc.fetchSecretsAndConfigMaps(result)
      }).then(result => {
        expect(result.kind).to.equal('List');
        expect(result.items.length).to.equal(5);
        return oc.importImageStreams(result, deploymentVersion, buildNamespace, buildVersion).then(result=>{
          return oc.applyAndWait(result);
        })
      }).then(result => {
        //console.dir(result)
        console.log('done!')
      })
    });
    

    /*
    it('startBuilds', function() {
      this.timeout(200000);
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
    */
  });
//});
