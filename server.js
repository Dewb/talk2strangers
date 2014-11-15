var config = require('config'),
    util = require('util');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));

var boxOpen = false;
var boxCloseTimeoutCB = null;

var users = {};
var waitingQueue = [];
var conversations = {};
var commands = [];

app.use(client.middleware());
app.get('/box', function(req, res, next) {
    res.send(boxOpen ? "1" : "0");
});
app.get('/commands', function(req, res, next) {
    res.send(JSON.stringify(commands));
});
app.listen(config.get("http.port"));

function getUser(msg) {
    return users[msg.From];
}

function createUser(msg) {
    var number = msg.From;
    if (!(number in users)) {
        users[number] = { 
            "number": number,
            "joined": new Date(),
            "master": true,
            "active": true
        };
    }
    return users[number];
}

function deactivateUser(user) {
    logConversation(user, "SYS", "Deactivating user " + util.inspect(user));
    user.active = false;
}

function countActiveUsers() {
    var active = 0;
    for (var number in users) {
        var user = users[number];
        if (user.active) { 
            active++; 
        }
    }
    return active;
}

function countFollowers() {
    var followers = 0;
    for (var number in users) {
        var user = users[number];
        if (user.active && !user.master) { 
            followers++; 
        }
    }
    return followers;
}

function logConversation(user, direction, messageText) {
    if (!(user.number in conversations)) {
        conversations[user.number] = [];
    }
    var c = conversations[user.number];
    c.push([direction, messageText]);
    console.log(user.number + " " + direction + " " + messageText);
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

    function sendMessageToUser(user, messageText, delay) {
        delay = delay || 100;
        setTimeout(function() { 
            app.sendSMS(config.get("app.serviceNumber"), user.number, messageText, function (err, msg) {
                if (err) {
                    console.log(err);
                }
                logConversation(user, "SENT", messageText);
            });
        }, 
        delay);
    }

    function sendMessageToFollowers(originatingUser, messageText) {
        for (var number in users) {
            user = users[number];
            if (user.active && number != originatingUser.number) {
                if (!user.master) {
                   sendMessageToUser(user, messageText);
                } else {
                   // master that never responded
                   checkMasterTimeoutAndMaybeDemote(user, messageText); 
                }
            }
        }
    }

    function checkMasterTimeoutAndMaybeDemote(user) {
        var now = new Date();
        if (now - user.joined > config.get("timing.masterResponseTimeout")) {
            user.master = false;
            sendMessageToUser(user, config.get("text.masterTimedOutMessage"));
            sendMessageToUser(user, config.get("text.masterToFollowerMessage"), config.get("timing.masterToFollowerDelay"));
            return true;
        }
        return false;
    }

    function addUserToGame(msg) {
        var user = createUser(msg);
        logConversation(user, "RECV", msg.Body);
        
        var command = msg.Body;
        var followers = countFollowers();
        
        if (followers > 0) {
            commands.push(command);
            sendMessageToFollowers(user, command);
            sendMessageToUser(
                user, 
                String.format(config.get("text.confirmCommandPrompt"), followers, (followers == 1 ? "person" : "people")),
                config.get("timing.commandExecutionTime"));
        } else {
            // This is the first user, nobody to send their command to
            user.master = false;
            sendMessageToUser(user, config.get("text.firstParticipantMessage"));
        }
    }

    function recordVerificationFromMaster(user, msg) {
        user.master = false;
        if (checkMasterTimeoutAndMaybeDemote(user)) {
            return;
        }
        if (msg.Body.toLowerCase().indexOf("y") != -1) {
            openBox();
            sendMessageToUser(user, config.get("text.commandSuccessfulMessage"));
            sendMessageToUser(user, config.get("text.masterToFollowerMessage"), config.get("timing.masterToFollowerDelay"));
        } else {
            closeBox();
            sendMessageToUser(user, config.get("text.commandUnsuccessfulMessage"));
        }
    }

    app.on('incomingSMSMessage', function(msg) {
        var user = getUser(msg);
        if (user == undefined) {
            setTimeout(function() { addUserToGame(msg); }, 100);
            return;
        } else if (msg.Body.toLowerCase() == config.get("text.quitCommand")) {
            deactivateUser(user);
        } else if (user.master) {
            recordVerificationFromMaster(user, msg);
        } else if (!user.active) {
            user.active = true;
            sendMessageToUser(user, config.get("text.userReactivatedMessage"));
        }
        logConversation(user, "RECV", msg.Body);
    });
});
