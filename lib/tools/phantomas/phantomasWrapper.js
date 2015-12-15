var async                   = require('async');
var Q                       = require('q');
var ps                      = require('ps-node');
var path                    = require('path');
var debug                   = require('debug')('ylt:phantomaswrapper');
var phantomas               = require('phantomas');


var PhantomasWrapper = function() {
    'use strict';

    /**
     * This is the phantomas launcher. It merges user chosen options into the default options
     */
    this.execute = function(data) {

        var deferred = Q.defer();
        var task = data.params;

        var options = {
            
            // Cusomizable options
            'engine': task.options.phantomasEngine || 'webkit',
            'timeout': task.options.timeout || 30,
            'js-deep-analysis': task.options.jsDeepAnalysis || false,
            'user-agent': (task.options.device === 'desktop') ? 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) YLT Chrome/27.0.1453.110 Safari/537.36' : null,
            'tablet': (task.options.device === 'tablet'),
            'phone': (task.options.device === 'phone'),
            'screenshot': task.options.screenshot || false,
            'wait-for-selector': task.options.waitForSelector,
            'cookie': task.options.cookie,
            'auth-user': task.options.authUser,
            'auth-pass': task.options.authPass,
            'ignore-ssl-errors': true,

            // Mandatory
            'reporter': 'json:pretty',
            'analyze-css': true,
            'skip-modules': [
                'blockDomains', // not needed
                'domHiddenContent', // overriden
                'domMutations', // not compatible with webkit
                'domQueries', // overriden
                'events', // overridden
                'filmStrip', // not needed
                'har', // not needed for the moment
                'javaScriptBottlenecks', // needs to be launched after custom module scopeYLT
                'jQuery', // overridden
                'jserrors', // overridden
                'lazyLoadableImages', //overriden
                'pageSource', // not needed
                'windowPerformance' // overriden
            ].join(','),
            'include-dirs': [
                path.join(__dirname, 'custom_modules/core'),
                path.join(__dirname, 'custom_modules/modules')
            ].join(',')
        };

        // Output the command line for debugging purpose
        debug('If you want to reproduce the phantomas task only, copy the following command line:');
        var optionsString = '';
        for (var opt in options) {
            var value = options[opt];
            
            if ((typeof value === 'string' || value instanceof String) && value.indexOf(' ') >= 0) {
                value = '"' + value + '"';
            }

            if (value === true) {
                optionsString += ' ' + '--' + opt;
            } else if (value === false || value === null || value === undefined) {
                // Nothing
            } else {
                optionsString += ' ' + '--' + opt + '=' + value;
            }

        }
        debug('node node_modules/phantomas/bin/phantomas.js --url=' + task.url + optionsString + ' --verbose');


        var phantomasPid;
        var isKilled = false;

        // Kill phantomas if nothing happens
        var killer = setTimeout(function() {
            console.log('Killing phantomas because the test on ' + task.url + ' was launched ' + 5*options.timeout + ' seconds ago');
            
            if (phantomasPid) {
                ps.kill(phantomasPid, function(err) {
                    
                    if (err) {
                        debug('Could not kill Phantomas process %s', phantomasPid);

                        // Suicide
                        process.exit(1);
                        // If in server mode, forever will restart the server
                    }

                    debug('Phantomas process %s was correctly killed', phantomasPid);

                    // Then mark the test as failed
                    // Error 1003 = Phantomas not answering
                    deferred.reject(1003);
                    isKilled = true;
                });
            } else {
                // Suicide
                process.exit(1);
            }

        }, 5*options.timeout*1000);


        // It's time to launch the test!!!
        var triesNumber = 2;
        var currentTry = 0;

        async.retry(triesNumber, function(cb) {

            currentTry ++;
            // Fix for https://github.com/gmetais/YellowLabTools/issues/114
            if (currentTry === 2 && options.engine === 'webkit2') {
                debug('Launching a second try with the old webkit v1 engine');
                options.engine = 'webkit';
            }

            var process = phantomas(task.url, options, function(err, json, results) {
                var errorCode = err ? parseInt(err.message, 10) : null;
                
                if (isKilled) {
                    debug('Process was killed, too late Phantomas, sorry...');
                    return;
                }


                debug('Returning from Phantomas with error %s', errorCode);

                // Adding some YellowLabTools errors here
                if (json && json.metrics && (!json.metrics.javascriptExecutionTree || !json.offenders.javascriptExecutionTree)) {
                    errorCode = 1001;
                }

                if (!errorCode && (!json || !json.metrics)) {
                    errorCode = 1002;
                }

                // Don't cancel test if it is a timeout and we've got some results
                if (errorCode === 252 && json) {
                    debug('Timeout after ' + options.timeout + ' seconds. But it\'s not a problem, the test is valid.');
                    errorCode = null;
                }

                if (errorCode) {
                    debug('Attempt failed. Error code ' + errorCode);
                }

                cb(errorCode, json);
            });
            
            phantomasPid = process.pid;

        }, function(err, json) {

            clearTimeout(killer);

            if (err) {
                debug('All ' + triesNumber + ' attemps failed for the test');
                deferred.reject(err);

            } else {

                deferred.resolve(json);

            }
        });

        return deferred.promise;
    };
};

module.exports = new PhantomasWrapper();
