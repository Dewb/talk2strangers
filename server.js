var config = require('config'),
    util = require('util');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));
var nedb = require('nedb'),
    users = new nedb({filename: 'users.db', autoload: true}),
    conversations = new nedb({filename: 'conversations.db', autoload: true})

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
    users.findOne({number: msg.From}, function (err, doc) {
        return doc;
    });
}

function createUser(msg) {
    var number = msg.From;
    users.findOne({number: number}, function (err, user) {
      if (user != null) {
        return user;
      } else {
        user =  {
            "number": number,
            "joined": new Date(),
            "master": true,
            "active": true
        };
        users.insert(user, function (err, user) { return user; });
      }
    });
}

function deactivateUser(user) {
    logConversation(user, "SYS", "Deactivating user " + util.inspect(user));
    users.update({ number: user.number }, { $set: { active: false } });
}

function countActiveUsers() {
    users.count({ active: true }, function (err, count) {
        return count;
    });
}

function countFollowers() {
    users.count({ active: true, master: false }, function (err, count) {
        return count;
    });
}

function logConversation(user, direction, messageText) {
    conversations.count({ number: user.number}, function (err, count) {
        if (count == 0) {
            conversations.insert({ number: user.number, conversations: [[direction, messageText]] });
        } else {
            conversations.update({ number: user.number}, { $push: { conversations: [direction, messageText] } });
        }
    });
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
        delay = delay || 30;
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
        users.find({ active: true, $not: { number: originatingUser.number }}, function (err, activeUsers) {
            for (var user in activeUsers) {
                if (!user.master) {
                   sendMessageToUser(user, messageText);
                } else {
                   // master that never responded
                   checkMasterTimeoutAndMaybeDemote(user, messageText); 
                }
            }
        });
    }

    function checkMasterTimeoutAndMaybeDemote(user) {
        var now = new Date();
        users.find({ number: user.number }, function (err, user) {
            if (now - user.joined > config.get("timing.masterResponseTimeout")) {
                users.update({ number: user.number }, { $set: { master: false } } );
                sendMessageToUser(user, config.get("text.masterTimedOutMessage"));
                sendMessageToUser(user, config.get("text.masterToFollowerMessage"), config.get("timing.masterToFollowerDelay"));
                return true;
            } else {
                return false;
            }
        });
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
            users.update({ number: msg.From }, { $set: { master: false } });
            sendMessageToUser(user, config.get("text.firstParticipantMessage"));
        }
    }

    function recordVerificationFromMaster(user, msg) {
        users.update({ number: user.number }, { $set: {master: false } }, function (err, user) {
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
      });
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
            users.update({ number: user.number }, { $set: { active: true } });
            sendMessageToUser(user, config.get("text.userReactivatedMessage"));
        } else {
            // follower can't send any commands, convince them to recruit someone else
            sendMessageToUser(user, config.get("text.followerChatterMessage"));
        }
        logConversation(user, "RECV", msg.Body);
    });
});
