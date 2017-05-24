// # Local File System Image Storage module
// The (default) module for storing images, using the local file system

var serveStatic = require('express').static,
    fs = require('fs-extra'),
    os = require('os'),
    path = require('path'),
    util = require('util'),
    Promise = require('bluebird'),
    errors = require('../errors'),
    config = require('../config'),
    utils = require('../utils'),
    BaseStore = require('./base'),
    remove = Promise.promisify(fs.remove);

function LocalFileStore() {
    BaseStore.call(this);
}

util.inherits(LocalFileStore, BaseStore);

// ### Save
// Saves the file to storage (the file system)
// - file is the express file object
// - type is the upload type: files or documents
// - returns a promise which ultimately returns the full url to the uploaded file
LocalFileStore.prototype.save = function (file, type, targetDir) {
    var fileTypePath = config.paths[type + 'Path'];
    var fileTypeRelPath = config.paths[type + 'RelPath'];
    var targetFilename;

    if (!type || !fileTypePath || !fileTypeRelPath) {
        throw new errors.IncorrectUsage('Incorrect file type was specified for: ' + file.name);
    }

    targetDir = targetDir || this.getTargetDir(fileTypePath);

    return this.getUniqueFileName(this, file, targetDir).then(function (filename) {
        targetFilename = filename;
        return Promise.promisify(fs.mkdirs)(targetDir);
    }).then(function () {
        return Promise.promisify(fs.copy)(file.path, targetFilename);
    }).then(function () {
        // The src for the file must be in URI format, not a file system path, which in Windows uses \
        // For local file system storage can use relative path so add a slash
        var fullUrl = (config.paths.subdir + '/' + fileTypeRelPath + '/' +
        path.relative(fileTypePath, targetFilename)).replace(new RegExp('\\' + path.sep, 'g'), '/');
        return fullUrl;
    }).catch(function (e) {
        errors.logError(e);
        return Promise.reject(e);
    });
};

LocalFileStore.prototype.exists = function (filename) {
    return new Promise(function (resolve) {
        fs.stat(filename, function (err) {
            var exists = !err;
            resolve(exists);
        });
    });
};

// middleware for serving the files
LocalFileStore.prototype.serve = function (options) {
    options = options || {};

    // CASE: serve themes
    // serveStatic can't be used to serve themes, because
    // download files depending on the route (see `send` npm module)
    if (options.isTheme) {
        return function downloadTheme(req, res, next) {
            var themeName = options.name,
                themePath = path.join(config.paths.themePath, themeName),
                zipName = themeName + '.zip',
                // store this in a unique temporary folder
                zipBasePath = path.join(os.tmpdir(), utils.uid(10)),
                zipPath = path.join(zipBasePath, zipName),
                stream;

            Promise.promisify(fs.ensureDir)(zipBasePath)
                .then(function () {
                    return Promise.promisify(utils.zipFolder)(themePath, zipPath);
                })
                .then(function (length) {
                    res.set({
                        'Content-disposition': 'attachment; filename={themeName}.zip'.replace('{themeName}', themeName),
                        'Content-Type': 'application/zip',
                        'Content-Length': length
                    });

                    stream = fs.createReadStream(zipPath);
                    stream.pipe(res);
                })
                .catch(function (err) {
                    next(err);
                })
                .finally(function () {
                    remove(zipBasePath);
                });
        };
    } else {
        var type = options.type || 'images';
        var typePath = type + 'Path';

        // CASE: serve images and documents
        // For some reason send divides the max age number by 1000
        // Fallthrough: false ensures that if an image isn't found, it automatically 404s
        return serveStatic(config.paths[typePath], {maxAge: utils.ONE_YEAR_MS, fallthrough: false});
    }
};

LocalFileStore.prototype.delete = function (fileName, targetDir) {
    targetDir = targetDir || this.getTargetDir(config.paths.imagesPath);

    var pathToDelete = path.join(targetDir, fileName);
    return remove(pathToDelete);
};

module.exports = LocalFileStore;
