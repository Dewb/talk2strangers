var config = require('config'),
    util = require('util');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));
var nedb = require('nedb'),
    users = new nedb({filename: 'data/users.db', autoload: true}),
    history = new nedb({filename: 'data/history.db', autoload: true});

app.use(client.middleware());
app.get('/chatter', function(req, res, next) {
    history.findOne({ history: "chatter" }, function (err, chatterHistory) {
        res.send("{" + JSON.stringify(chatterHistory.contents) + "}");
    });
});
app.listen(config.get("http.port"));

function getUser(usernum, callback) {
    users.findOne({number: usernum}, callback);
}

function countActiveUsers(callback) {
    users.count({ active: true }, callback);
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

function logChatter(chatter) {
    history.count({ history: "chatter" }, function (err, count) {
        if (err) { logError(err); }
        if (count == 0) {
            history.insert({ history: "chatter", contents: [chatter] });
        } else {
            history.update({ history: "chatter" }, { $push: { contents: chatter }});
        }
    });
}

function logError(err) {
    console.log(util.inspect(err));
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

    function sendMessage(user, messageText, delay) {
        if (!user.active) {
            logError("Tried to send message to inactive user!");
            return;
        }
        delay = delay || 30;
        setTimeout(function() { 
            app.sendSMS(config.get("app.serviceNumber"), user.number, messageText, function (err, msg) {
                if (err) { logError(err); }
                logConversation(user.number, "< SENT", messageText);
            });
        }, 
        delay);
    }

    function endConversationForUser(user) {
        if (user.strangerNumber != null) {
            users.update({ number: user.strangerNumber }, { $set: { strangerNumber: null } });
            getUser(user.strangerNumber, function (err, otherUser) {
                if (otherUser != null) {
                    sendMessage(otherUser, config.get("text.conversationEndedMessage"));
                }
            });
        }
        users.update({ number: user.number }, { $set: { strangerNumber: null } });
    }

    function processWaitingQueue() {
        users.find({ active: true, strangerNumber: null }, function (err, waitingUsers) {
            if (waitingUsers.length > 0) {
                console.log("Number of users waiting for a connection: " + waitingUsers.length);
            }
            while (waitingUsers.length >= 2) {
                connectStrangers(waitingUsers.shift(), waitingUsers.shift());
            }
        });
    }

    function connectStrangers(user1, user2) {
        users.update({ number: user1.number }, { $set: { active: true, strangerNumber: user2.number }, $push: { strangerHistory: user2.number } });
        users.update({ number: user2.number }, { $set: { active: true, strangerNumber: user1.number }, $push: { strangerHistory: user1.number } });

        logConversation(user1.number, "SYSTEM", "New conversation with " + user2.number)
        logConversation(user2.number, "SYSTEM", "New conversation with " + user1.number)

        sendMessage(user1, config.get("text.newConversationMessage"));
        sendMessage(user2, config.get("text.newConversationMessage"));
    }

    function addUserToSystem(msg) {
        var number = msg.From;
        users.findOne({number: number}, function (err, user) {
            if (err) { logError(err); }
            if (user == null) {
                user =  {
                    "number": number,
                    "joined": new Date(),
                    "strangerNumber": null,
                    "active": true,
                    "strangerHistory": []
                };
                users.insert(user, function (err, user) {
                    sendMessage(user, config.get("text.newUserMessage"));
                });
            }
        });
    }

    function deactivateUser(user) {
        logConversation(user.number, "SYSTEM", "Deactivating user");
        endConversationForUser(user);
        sendMessage(user, config.get("text.userDeactivatedMessage"));
        users.update({ number: user.number }, { $set: { active: false } });
    }

    function relayConversationToStranger(user, messageText) {
        if (user.strangerNumber != null) {
            getUser(user.strangerNumber, function (err, otherUser) {
                if (otherUser != null) {
                    sendMessage(otherUser, messageText);
                    logChatter(messageText);
                }
            });
        }
    }

    var quitCommands = config.get("text.quitCommands");

    function isQuitCommand(text) {
        for (var i = 0; i < quitCommands.length; i++) {
            if (quitCommands[i] == text) {
                return true;
            }
        }
        return false;
    }

    app.on('incomingSMSMessage', function(msg) {
        logConversation(msg.From, "> RECV", msg.Body);
        getUser(msg.From, function (err, user) {
            if (err) { logError(err); }
            if (user == undefined) {
                addUserToSystem(msg);
            } else if (isQuitCommand(msg.Body.toLowerCase())) {
                deactivateUser(user);
            } else if (msg.Body.toLowerCase() == config.get("text.newStrangerCommand")) {
                sendMessage(user, config.get("text.conversationEndedMessage"));
                endConversationForUser(user);
            } else if (!user.active) {
                users.update({ number: user.number }, { $set: { active: true } }, function (err, num) {
                    if (err) { logError(err); }
                    sendMessage(user, config.get("text.userReactivatedMessage"));          
                });
            } else {
                relayConversationToStranger(user, msg.Body);
            }
        });      
    });

    setInterval(function() {
        processWaitingQueue();
    }, 7000)
});
