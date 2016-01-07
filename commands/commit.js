define(['utils/file_utils', 'utils/misc_utils', 'utils/errors'], function (fileutils, miscutils, errutils) {

    var walkFiles = function(dir, store, success){//TODO: Refactoring!!!
        fileutils.ls(dir, function(entries){
            if (!entries.length){
                success();
                return;
            }
            var treeEntries = [];
            var Async = app.getModule("utils/Async");
            var processAllResolvedEntries = function () {
                treeEntries.sort(function (a, b) {
                    //http://permalink.gmane.org/gmane.comp.version-control.git/195004
                    var aName = a.isBlob ? a.name : (a.name + '/');
                    var bName = b.isBlob ? b.name : (b.name + '/');
                    if (aName < bName) return -1;
                    else if (aName > bName) return 1;
                    else
                        return 0;
                });
                store._writeTree(treeEntries, success);
            };
            var readEntry = function (entry, index) {
                var promise = new $.Deferred();
                if (entry.name == '.git') {
                    return promise.resolve().promise();
                }
                if (entry.isDirectory) {
                    walkFiles(entry, store, function (sha) {
                        if (sha) {
                            treeEntries.push({
                                name: /*'40000 ' + */entry.name,
                                sha: miscutils.convertShaToBytes(sha),
                                isBlob: false
                            });
                        }
                        promise.resolve();
                    });

                } else {
                    entry.readAsText(function (content) {
                        var reader = new FileReader();
                        reader.onloadend = function () {
                            store.writeRawObject('blob', new Uint8Array(reader.result), function (sha) {
                                treeEntries.push({
                                    name: /*'100644 ' + */entry.name,
                                    sha: miscutils.convertShaToBytes(sha),
                                    isBlob: true
                                });
                                promise.resolve();
                            });
                        }
                        reader.onerror = function (err) {
                            promise.reject();
                        }
                        reader.readAsArrayBuffer(new Blob([content]));
                    });
                }
                return promise.promise();
            };
            var masterPromise = Async.doInParallel(entries, readEntry, true);
            masterPromise.done(function () {
                processAllResolvedEntries();
            }).fail(function (err) {
                throw err;
            });
        });       
    }

    var checkTreeChanged = function(store, parent, sha, success, error){
        if (!parent || !parent.length || parent === '0000000000000000000000000000000000000000') {
            success();
        }
        else{
            store._retrieveObject(parent, "Commit", function(parentCommit){
                var oldTree = parentCommit.tree;
                if (oldTree == sha){
                    error({type: errutils.COMMIT_NO_CHANGES, msg: errutils.COMMIT_NO_CHANGES_MSG});
                }
                else{
                    success();
                }
            }, function(){
                error({type: errutils.OBJECT_STORE_CORRUPTED, msg: errutils.OBJECT_STORE_CORRUPTED_MSG});  
            })
        }
    }

    var _createCommitFromWorkingTree =  function(options, parent, ref, success, error){ 

        var dir = options.dir,
            store = options.objectStore,
            username = options.username,
            email = options.email,
            commitMsg = options.commitMsg;

        walkFiles(dir, store, function(sha){
            checkTreeChanged(store, parent, sha, function(){
                var now = new Date();
                var dateString = Math.floor(now.getTime()/1000);
                var offset = now.getTimezoneOffset()/-60;
                var absOffset = Math.abs(offset);
                var offsetStr = '' + (offset < 0 ? '-' : '+') + (absOffset < 10 ? '0' : '') + absOffset + '00';
                dateString = dateString + ' ' + offsetStr;
                var commitContent = ['tree ',sha,'\n'];
                if (parent && parent.length && parent != '0000000000000000000000000000000000000000'){
                    commitContent.push('parent ', parent);
                    if (parent.charAt(parent.length - 1) != '\n'){
                        commitContent.push('\n');
                    }
                }
                    
                commitContent.push('author ', username, ' <',email, '> ',  dateString,'\n', 
                    'committer ', username,' <', email, '> ', dateString, '\n\n', commitMsg,'\n');
                store.writeRawObject('commit', commitContent.join(''), function(commitSha){
                    fileutils.mkfile(dir, '.git/' + ref, commitSha + '\n', function(){
                        store.updateLastChange(null, function(){
                            success(commitSha);
                        });
                    });
                });
            }, error);
        });
    }

    var commit = function(options, success, error){
        var rootDir = options.dir,
            objectStore = options.objectStore;

        var ref;
        var buildCommit = function(parent){
            _createCommitFromWorkingTree(options, parent, ref, success, error);
        }
        objectStore.getHeadRef(function(headRef){
            ref = headRef;
            objectStore._getHeadForRef(ref, buildCommit, function(){ buildCommit(); });
        });
    }

    return commit;

});