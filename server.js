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

var waitingQueue = [];

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
    processWaitingQueue();

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

    function queueUserForConversation(user) {
        users.update({ number: user.strangerNumber }, { $set: { strangerNumber: null } });
        if (waitingQueue.indexOf(user.number) == -1) {
            waitingQueue.push(user.number);
        }
        processWaitingQueue();
    }

    function processWaitingQueue() {
        users.find({ strangerNumber: null }, function (err, waitingUsers) {
            for (var user in waitingUsers) {
                if (waitingQueue.indexOf(user.number) == -1) {
                    waitingQueue.push(user.number);
                }
            }
            while (waitingQueue.length >= 2) {
                var number1 = waitingQueue.shift();
                var number2 = waitingQueue.shift();
                users.findOne({number: number1}, function (err, user1) {
                    if (err) { logError(err); }
                    users.findOne({number: number2}, function (err, user2) {
                        if (err) { logError(err); }
                        connectStrangers(user1, user2);
                    });
                });
            }
        });
    }

    function connectStrangers(user1, user2) {
        users.update({ number: user1.number }, { $set: { active: true, strangerNumber: user2.number } });
        users.update({ number: user2.number }, { $set: { active: true, strangerNumber: user1.number } });

        logConversation(user1, "SYSTEM", "New conversation with " + user2.number)
        logConversation(user2, "SYSTEM", "New conversation with " + user1.number)

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
                    "active": true
                };
                users.insert(user, function (err, user) {
                    sendMessage(user, config.get("text.newUserMessage"));
                    queueUserForConversation(user);
                });
            }
        });
    }

    function deactivateUser(user) {
        logConversation(user.number, "SYSTEM", "Deactivating user");
        if (user.strangerNumber != null) {
            getUser(user.strangerNumber, function (err, otherUser) {
                queueUserForConversation(otherUser);
            });
        }
        users.update({ number: user.number }, { $set: { active: false, strangerNumber: null } });
    }

    function relayConversationToStranger(user, messageText) {
        if (user.strangerNumber != null) {
            getUser(user.strangerNumber, function (err, otherUser) {
                sendMessage(otherUser, messageText);
                logChatter(messageText);
            });
        }
    }

    app.on('incomingSMSMessage', function(msg) {
        logConversation(msg.From, "> RECV", msg.Body);
        getUser(msg.From, function (err, user) {
            if (err) { logError(err); }
            if (user == undefined) {
                addUserToSystem(msg);
            } else if (msg.Body.toLowerCase() == config.get("text.quitCommand")) {
                deactivateUser(user);
            } else if (msg.Body.toLowerCase() == config.get("text.newStrangerCommand")) {
                queueUserForConversation(user);
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
});
