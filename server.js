var config = require('config'),
    util = require('util');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));
var nedb = require('nedb'),
    users = new nedb({filename: 'data/users.db', autoload: true}),
    history = new nedb({filename: 'data/history.db', autoload: true});

var boxOpen = false;
var boxCloseTimeoutCB = null;

app.use(client.middleware());
app.get('/box', function(req, res, next) {
    res.send(boxOpen ? "1" : "0");
});
app.get('/commands', function(req, res, next) {
    history.findOne({ history: "commands" }, function (err, commandHistory) {
        res.send("{" + JSON.stringify(commandHistory.contents) + "}");
    });
});
app.listen(config.get("http.port"));

function getUser(msg, callback) {
    users.findOne({number: msg.From}, callback);
}

function createUser(msg, callback) {
    var number = msg.From;
    users.findOne({number: number}, function (err, user) {
        if (err) { logError(err); }

        if (user != null) {
            return user;
        } else {
            user =  {
                "number": number,
                "joined": new Date(),
                "master": true,
                "active": true
            };
            users.insert(user, callback);
        }
    });
}

function deactivateUser(userNumber) {
    logConversation(userNumber, "SYSTEM", "Deactivating user");
    users.update({ number: userNumber }, { $set: { active: false } });
}

function countActiveUsers(callback) {
    users.count({ active: true }, callback);
}

function countFollowers(callback) {
    users.count({ active: true, master: false }, callback);
}

function logConversation(userNumber, direction, messageText) {
    history.count({ number: userNumber}, function (err, count) {
        if (err) { logError(err); }
        if (count == 0) {
            history.insert({ number: userNumber, conversations: [[direction, messageText]] });
        } else {
            history.update({ number: userNumber }, { $push: { conversations: [direction, messageText] } });
        }
    });
    console.log(userNumber + " " + direction + " " + messageText);
}

function logCommand(command) {
    history.count({ history: "commands" }, function (err, count) {
        if (err) { logError(err); }
        if (count == 0) {
            history.insert({ history: "commands", contents: [command] });
        } else {
            history.update({ history: "commands" }, { $push: { contents: command }});
        }
    });
}

function logError(err) {
    console.log(util.inspect(err));
}

function openBox() {
    setBoxState(true);
}

function closeBox() {
    setBoxState(false);
}

function setBoxState(shouldOpen) {
    var duration = config.get("timing.boxOpenDuration");
    if (shouldOpen) {
        if (boxOpen) {
            clearTimeout(boxCloseTimeoutCB);
            console.log("*** Box already open, resetting timeout.");
        }
        boxCloseTimeoutCB = setTimeout(closeBox, duration);
        console.log("*** Box open, closing in " + Math.floor(duration/1000) + " seconds.");
        boxOpen = true;
    } else if (boxOpen && !shouldOpen) {
        console.log("*** Closing box!");
        boxOpen = false;
    } 
}

if (!String.format) {
  String.format = function(format) {
    var args = Array.prototype.slice.call(arguments, 1);
    return format.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number] 
        : match
      ;
    });
  };
}

console.log("                   _                                        ");
console.log(" _|_  _,  |\\ |)   / )  , _|_  ,_   _,         _,  _  ,_   ,  ");
console.log("  |  / |  |/ |/)   /  / \\_|  /  | / |  /|/|  / | |/ /  | / \\_");
console.log("  |_/\\/|_/|_/| \\/ /__  \\/ |_/   |/\\/|_/ | |_/\\/|/|_/   |/ \\/ ");
console.log("                                              (|             ");

client.account.getApplication(config.get("twilio.applicationSid"), function(err, app) {
    if (err) {
        throw err;
    }
    app.register();
    console.log("Application registered");

    function sendMessage(userNumber, messageText, delay) {
        delay = delay || 30;
        setTimeout(function() { 
            app.sendSMS(config.get("app.serviceNumber"), userNumber, messageText, function (err, msg) {
                if (err) { logError(err); }
                logConversation(userNumber, "< SENT", messageText);
            });
        }, 
        delay);
    }

    function sendMessageFromMasterToFollowers(masterNumber, messageText) {
        users.find({ active: true, $not: { number: masterNumber }}, function (err, activeUsers) {
            if (err) { logError(err); }
            for (var userIndex in activeUsers) {
                var user = activeUsers[userIndex];
                if (!user.master) {
                   sendMessage(user.number, messageText);
                } else {
                   // master that never responded
                   checkMasterTimeoutAndMaybeDemote(user.number); 
                }
            }
        });
    }

    function checkMasterTimeoutAndMaybeDemote(userNumber, callback) {
        users.findOne({ number: userNumber }, function (err, user) {
            if (err) { logError(err); }
            var now = new Date();
            if (now - user.joined > config.get("timing.masterResponseTimeout")) {
                users.update({ number: userNumber }, { $set: { master: false } }, function (err, num) {
                    if (err) { logError(err); }
                    sendMessage(userNumber, config.get("text.masterTimedOutMessage"));
                    sendMessage(userNumber, config.get("text.masterToFollowerMessage"), config.get("timing.masterToFollowerDelay"));
                    if (callback) { callback(true); }
                });
            } else {
                if (callback) { callback(false); }
            }
        });
    }

    function addUserToGame(msg) {
        createUser(msg, function (err, user) {  
            if (err) { logError(err); }     
            var command = msg.Body;
            countFollowers(function (err, followerCount) {
                if (err) { logError(err); }
                if (followerCount > 0) {
                    logCommand(command);
                    sendMessageFromMasterToFollowers(user.number, command);
                    sendMessage(
                        user.number, 
                        String.format(config.get("text.confirmCommandPrompt"), followerCount, (followerCount == 1 ? "person" : "people")),
                        config.get("timing.commandExecutionTime"));
                } else {
                    // This is the first user, nobody to send their command to
                    users.update({ number: user.number }, { $set: { master: false } }, function (err, num) {
                        if (err) { logError(err); }
                        sendMessage(user.number, config.get("text.firstParticipantMessage"));
                    });
                }                
            });
        });
    }

    function recordVerificationFromMaster(masterNumber, msg) {
        users.update({ number: masterNumber }, { $set: { master: false } }, function (err, num) {
            if (err) { logError(err); }
            checkMasterTimeoutAndMaybeDemote(masterNumber, function (demoted) {
                if (demoted) {
                    return;
                } else {
                    if (msg.Body.toLowerCase().indexOf("y") != -1) {
                        openBox();
                        sendMessage(masterNumber, config.get("text.commandSuccessfulMessage"));
                        sendMessage(masterNumber, config.get("text.masterToFollowerMessage"), config.get("timing.masterToFollowerDelay"));
                        sendMessageFromMasterToFollowers(masterNumber, config.get("text.followerSuccessfulMessage"));
                    } else {
                        closeBox();
                        sendMessage(masterNumber, config.get("text.commandUnsuccessfulMessage"));
                    }
                }
            });
        });
    }

    app.on('incomingSMSMessage', function(msg) {
        logConversation(msg.From, "> RECV", msg.Body);
        getUser(msg, function (err, user) {
            if (err) { logError(err); }
            if (user == undefined) {
                addUserToGame(msg);
            } else if (msg.Body.toLowerCase() == config.get("text.quitCommand")) {
                deactivateUser(user.number);
            } else if (user.master) {
                recordVerificationFromMaster(user.number, msg);
            } else if (!user.active) {
                users.update({ number: user.number }, { $set: { active: true } }, function (err, num) {
                    if (err) { logError(err); }
                    sendMessage(user.number, config.get("text.userReactivatedMessage"));          
                });
            } else {
                // follower can't send any commands, convince them to recruit someone else
                sendMessage(user.number, config.get("text.followerChatterMessage"));
            }
        });      
    });
});
