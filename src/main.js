'use strict';
const {spawn} = require('child_process');

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

function _oc (client) {
  return function create (args = [], stdin = null) {
    return new Promise(function(resolve, reject) {
      const _args = asArray(client.settings.options).concat(asArray(args))
      console.log(`oc ${_args.join(' ')}`)
      const process = spawn('oc', _args);
      let stdout=''
      if (stdin!=null){
        stdin(process.stdin)
      }
      process.stdout.on('data', (data) => {
        //console.log(`1>${data}`)
        stdout+=data
      });
      process.stderr.on('data', (data) => {
        console.log(`2>${data}`)
      })
      process.on('exit', (code) => {
        resolve({'code':code, 'stdout':stdout})
      });  
    });
  };
}

function ocProcess (client) {
  return function create (args = []) {
    const _args=['process', '--output=json'].concat(asArray(args))
    return client._raw(_args).then((result)=>{
      let items=JSON.parse(result.stdout)
      
      return items;
    });
  };
}

function ocApply (client) {
  return function create (args = []) {
    var stdin=null;
    var items=null;
    if (!(args instanceof Array)) {
      //console.log('!args instanceof Array')
      if (!(args['filename'] instanceof String)){
        //console.log('!args["filename"] instanceof String')
        items=args['filename']
        args['filename']='-'
        stdin=(stdin)=>{stdin.setEncoding('utf-8'); stdin.write(JSON.stringify(items)); stdin.end();}
      }
    }

    const _args=['apply', '--output=json'].concat(asArray(args))
    return client._raw(_args, stdin).then((result)=>{
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
        //console.log(`[${index}]=${value}`)
        items[index]=JSON.parse(value)
      });
      //require('fs').writeFile('_oc_apply_stdout.json', result.stdout, 'utf8')
      return items; //JSON.parse(result.stdout)
    });
  };
}

function openShiftClient (settings = {}) {
  const client = {};
  settings = settings || {}
  settings.options =settings.options || {}

  client['settings']=settings || {}  
  client['_raw'] = _oc(client)
  client['process'] = ocProcess(client)
  client['apply'] = ocApply(client)
  return client;
}

module.exports = exports = openShiftClient;
