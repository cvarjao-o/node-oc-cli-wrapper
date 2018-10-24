const util=require('./util')
var loaded =false;

//https://log4js-node.github.io/log4js-node/faq.html
//'just-errors': { type: 'logLevelFilter', appender: 'emergencies', level: 'error' }

module.exports = exports = ()=>{
  if (!loaded){
    util.configureLogging({
      appenders: {
        console: { type: 'console' },
        file: { type: 'file', filename: 'output/pipeline-all.log'},
        warnings: { type: 'file', filename: 'output/pipeline-warn.log'},
        info: { type: 'file', filename: 'output/pipeline-info.log'},
        'level-warn': { type: 'logLevelFilter', appender: 'warnings', level: 'warn' },
        'level-info': { type: 'logLevelFilter', appender: 'info', level: 'info' }
      },
      categories: {
        default: { appenders: ['file', 'level-warn', 'level-info'], level: 'all' }
      }
    });
    loaded=true
  }
}
