const _           = require('lodash');
const apidoc      = require('apidoc-core');
const winston     = require('winston');
const path        = require('path');
const markdown    = require('marked');
const fs          = require('fs-extra');
const PackageInfo = require('./package_info');

const apidocOpenapi = require('./apidocToOpenapi');

const defaults = {
    dest    : path.join(__dirname, '../doc/'),
    template: path.join(__dirname, '../template/'),

    debug   : false,
    silent  : false,
    verbose : false,
    simulate: false,
    parse   : false, // only parse and return the data, no file creation
    colorize: true,
    markdown: true,

    marked: {
        gfm        : true,
        tables     : true,
        breaks     : false,
        pedantic   : false,
        sanitize   : false,
        smartLists : false,
        smartypants: false
    }
};

const app = {
    log     : {},
    markdown: false,
    options : {}
};

// uncaughtException
process.on('uncaughtException', function(err) {
    console.error((new Date()).toUTCString() + ' uncaughtException:', err.message);
    console.error(err.stack);
    process.exit(1);
});

function createApidocOpenapi(options) {
    let api;
    const apidocPath = path.join(__dirname, '../');
    let packageInfo;

    options = _.defaults({}, options, defaults);

    // paths
    options.dest     = path.join(options.dest, './');

    // options
    app.options = options;

    // logger
    app.log = new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({
                level      : app.options.debug ? 'debug' : app.options.verbose ? 'verbose' : 'info',
                silent     : app.options.silent,
                prettyPrint: true,
                colorize   : app.options.colorize,
                timestamp  : false
            }),
        ]
    });
    // markdown
    if(app.options.markdown === true) {
        app.markdown = markdown;
        app.markdown.setOptions(app.options.marked);
    }

    try {
        packageInfo = new PackageInfo(app);

        // generator information
        const json = JSON.parse( fs.readFileSync(apidocPath + 'package.json', 'utf8') );
        apidoc.setGeneratorInfos({
            name   : json.name,
            time   : new Date(),
            url    : json.homepage,
            version: json.version
        });
        apidoc.setLogger(app.log);
        apidoc.setMarkdownParser(app.markdown);
        apidoc.setPackageInfos(packageInfo.get());

        api = apidoc.parse(app.options);

        if (api === true) {
            app.log.info('Nothing to do.');
            return true;
        }
        if (api === false)
            return false;

        if (app.options.parse !== true){
            const apidocData = JSON.parse(api.data);
            const projectData = JSON.parse(api.project);
             api["openapiData"] = JSON.stringify(apidocOpenapi.toOpenapi(apidocData , projectData)); 
             createOutputFile(api);
        }

        app.log.info('Done.');
        return api;
    } catch(e) {
        app.log.error(e.message);
        if (e.stack)
            app.log.debug(e.stack);
        return false;
    }
}

function createOutputFile(api){
    if (app.options.simulate)
        app.log.warn('!!! Simulation !!! No file or dir will be copied or created.');

    app.log.verbose('create dir: ' + app.options.dest);
    if ( ! app.options.simulate)
        fs.mkdirsSync(app.options.dest);

    //Write openapi
    const destFile = app.options.dest + 'openapi.json'
    app.log.verbose('write openapi json file: ' + destFile);
    if( ! app.options.simulate)
        fs.writeFileSync(destFile, api.openapiData); 
}

module.exports = {
    createApidocOpenapi: createApidocOpenapi
};