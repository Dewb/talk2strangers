var commands = [];

$.getJSON('/commands', function(data) {
  $.each(data, function(key, val) {
    // Form urls and stuff
    commands.push(val);
  });
});

//commands = ["No, you do a hamster dance!","Drink some wine","Pet my schmao!","Open my wine with David's cork screw"];

for (var i=0; i < commands.length; i++) {
  var command = document.createElement('div');
  var clear = document.createElement('div');
  command.className = 'from-them';
  clear.className = 'clear';
  command.innerHTML = '<p>' + commands[i] + '</p>';
  
  document.getElementById('commands').appendChild(command);
  document.getElementById('commands').appendChild(clear);
}
