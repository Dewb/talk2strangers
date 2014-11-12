var config = require('config');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));

app.use(client.middleware());
app.listen(config.get("http.port"));

client.account.getApplication(config.get("twilio.applicationSid"), function(err, app) {
    if (err) {
        throw err;
    }
    app.register();
    app.sendSMS(config.get("app.serviceNumber"), config.get("app.debugNumber"), "testing from node", function (err, msg) {
        console.log("Message queued")
    });
    app.on('incomingSMSMessage', function(smsMessage) {
        console.log("Received message: " + JSON.stringify(smsMessage));
    });
});