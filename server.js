var config = require('config'),
    util = require('util');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));

app.use(client.middleware());
app.get('/box', function(req, res, next) {
    res.send({boxOpen: boxOpen});
});
app.listen(config.get("http.port"));

var users = {};
var waitingQueue = [];
var conversations = {};
var boxOpen = false;

function getUser(msg) {
    return users[msg.From];
}

function createUser(msg) {
    var number = msg.From;
    if (!(number in users)) {
        users[number] = { 
            "number": number,
            "joined": new Date(),
        };
    }
    return users[number];
}

function deactivateUser(user) {
    logConversation(user, "SYS", "Deleting user " + util.inspect(user));
    delete users[user.number];
}

function countActiveUsers() {
    return Object.keys(users).length;
}

function logConversation(user, direction, messageText) {
    if (!(user.number in conversations)) {
        conversations[user.number] = [];
    }
    var c = conversations[user.number];
    c.push([direction, messageText]);
    console.log(user.number + " " + direction + " " + messageText);
}

function setBoxState(shouldOpen) {
    boxOpen = shouldOpen;
    console.log(boxOpen ? "*** Opening box" : "*** Closing box");
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

    function sendMessageToUser(user, messageText) {
        setTimeout(function() { 
            app.sendSMS(config.get("app.serviceNumber"), user.number, messageText, function (err, msg) {
                if (err) {
                    console.log(err);
                }
                logConversation(user, "SENT", messageText);
            });
        }, 
        100);
    }

    function sendMessageToEveryoneElse(originatingUser, messageText) {
        for (number in users) {
            if (number != originatingUser.number) {
                sendMessageToUser(users[number], messageText);
            }
        }
    }

    function addUserToGame(msg) {
        user = createUser(msg);
        logConversation(user, "RECV", msg.Body);
        var followers = countActiveUsers() - 1;
        if (followers > 0) {
            sendMessageToEveryoneElse(user, msg.Body);
            var confirmCommandMessage = "Did " + followers + " " + (followers == 1 ? "person" : "people") + " follow your command?";
            sendMessageToUser(user, confirmCommandMessage);
        } else {
            sendMessageToUser(user, "You're the first participant! Wait for instructions.");
        }
    }

    app.on('incomingSMSMessage', function(msg) {
        var user = getUser(msg);
        if (user == undefined) {
            setTimeout(function() { addUserToGame(msg); }, 100);
            return;
        } else if (msg.Body.toLowerCase() == "quit") {
            deactivateUser(user);
            return;
        } else {
            if (msg.Body.toLowerCase().indexOf("y") != -1) {
                setBoxState(true);
            }
        }
        logConversation(user, "RECV", msg.Body);
    });
});
