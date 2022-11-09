// Require the packages we will use:
const http = require("http"),
      fs = require("fs");

const port = 3456;
const file = "../static/client.html";
var connections = {};
var chatRooms = [];
var users = {}
var chatHistory = {}; 
var privateMessages = {}; 
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html, on port 3456:
const server = http.createServer(function (req, res) {
    // This callback runs when a new connection is made to our HTTP server.

    fs.readFile(file, function (err, data) {
        // This callback runs when the client.html file has been read from the filesystem.

        if (err) return res.writeHead(500);
        res.writeHead(200);
        res.end(data);
    });
});
server.listen(port);

// Import Socket.IO and pass our HTTP server object to it.
const socketio = require("socket.io")(http, {
    wsEngine: 'ws'
});

// Attach our Socket.IO server to our HTTP server to listen
const io = socketio.listen(server);
io.sockets.on("connection", function (socket) {
    // This callback runs when a new Socket.IO connection is established.
    connections[socket.id]=socket;
    /*
    socket.on('message_to_server', function (data) {
        // This callback runs when the server receives a new message from the client.

        console.log("message: " + data["message"]); // log it to the Node.JS output
        io.sockets.emit("message_to_client", { message: data["message"] }) // broadcast the message to other users
    });
    */
    // create new chat room
    socket.on('create_new_room', function(data, callback) {
		var name = data["name"];
		var needPassword = data["need_password"];
		var password = data["password"];
		if (name) {
            for (var i = 0; i < chatRooms.length; i++) {
				var chatRoom = chatRooms[i];
				if (chatRoom.name == name) {
					callback( { success : false, message: "Name " + name + " is already taken" } );
					return;
				}
			}
			var owner = users[socket.id];
			var id = chatRooms.length;
			var room = new ChatRoom(id, name, owner);

			if (needPassword) {
				room.needPassword = true;
				room.password = password;
			}

			// if user is already in a room, remove user from the previous room
			if (socket.room) {
				console.log(owner.username + " leaving " + socket.room);
				removeUserFromAllRooms(chatRooms, owner);
				socket.leave(socket.room);
			}

			if (!chatHistory.hasOwnProperty(room.id)) {
				// create new chat history
				chatHistory[room.id] = [];
			}

			socket.room = room.name;
			socket.join(socket.room);
			
			room.addUser(owner);

			chatRooms.push(room);

			callback( { success : true, room_id: room.id } );
			console.log("chat rooms: "+chatRooms);

			io.sockets.in(socket.room).emit('update_room_users', { room: room } );
			io.sockets.in(socket.room).emit('update_blocked_users', { room: room } );
			io.sockets.emit("update_chat_rooms", { rooms: chatRooms } );

		} else {
			callback( { success : false, message : "chat room name cannot be empty" } );
		}
	});
    //create user
    socket.on('create_new_user', function(data, callback) {
		var username = data["username"];
		if (username) {
			socket.username = username;
            //check if user exists
			var userExists = false;
			var oldUserId;
			for (var id in users) {
				if (users.hasOwnProperty(id)) {
	            	if (users[id].username === username) {
	                	userExists = true;
	                	oldUserId = id;
	                    break;
	                }
                }
            }

			if (!userExists) {
                // create new user
				var user = new User(socket.id, socket.username);
				users[user.id] = user;
				console.log(username + " joined the server,the id is " + socket.id);

				} else {
                // Reset user id as socket id
				var oldUser = users[oldUserId];
				var user = oldUser;
				user.id = socket.id;
				users[user.id] = user;
				delete users.oldUserId;
				// update this user's id
				for (var i = 0; i < chatRooms.length; i++) {
					var room = chatRooms[i];

					if (room.owner.username === username) {
						room.owner.id = user.id;
					}
					for (var i = 0; i < room.users.length; i++) {
						var roomUser = room.users[i];
						if (roomUser.username === username) {
							roomUser.id = user.id;
						}
					}
					for (var i = 0; i < room.blockedUsers.length; i++) {
						var roomUser = room.blockedUsers[i];
						if (roomUser.username === username) {
							roomUser.id = user.id;
						}
					}
				}
				console.log(username + " rejoined the server, reset id as " + socket.id);
			
				}
					
			callback( { success: true } );

			io.sockets.emit("update_users", users);

			io.sockets.emit("update_chat_rooms", { rooms: chatRooms });
		} else {
			// handle error: username is empty
			callback( { success: false, message: "username cannot be empty, enter again!" } );
		}
	});

    //profile
    socket.on('request_user_info', function(data) {
		var currentUser = users[socket.id];

		var createdRooms = [];
		var blockedFromRooms = [];
		var SentMessagesCount = 0;
        console.log(currentUser);
		for (var i = 0; i < chatRooms.length; i++) {
			var room = chatRooms[i];
			if (room.owner.id === currentUser.id) {
				createdRooms.push(room.name);
			}
			
			for (var j = 0; j < room.blockedUsers.length; j++) {
				var user = room.blockedUsers[j];
				if (user.id === currentUser.id) {
					blockedFromRooms.push(room.name);
				}
			}

			if (chatHistory.hasOwnProperty(room.id)) {
				var messages = chatHistory[room.id];
				for (var j = 0; j < messages.length; j++) {
					var message = messages[j];
					if (message.user.id === currentUser.id) {
						SentMessagesCount++;
					}
				}
	        }
			
	    }

		socket.emit('recieved_user_info', { id: currentUser.id, username: currentUser.username, created_rooms: createdRooms, blocked_rooms: blockedFromRooms, sent_messages_count: SentMessagesCount } );
	});

    //disconnect
    socket.on('disconnect', function(data) {

		// remove this user from all other chat rooms' user lists
		var user = users[socket.id];
		if (typeof user !== "undefined") {
			removeUserFromAllRooms(chatRooms, user);
		}
		
		// remove socket connection
		delete connections[socket.id];
		console.log("Disconnected: " + Object.keys(connections).length + " connections remaining");

		// send update to all users
		io.sockets.emit("update_users", users);
		io.sockets.emit("update_chat_rooms", { rooms: chatRooms } );
	});

    //join room
    socket.on('join_room', function(data, callback) {
		var roomId = data["room_id"];
        if (roomId >= chatRooms.length){
            callback( { success : false, message : "Invalid chat room Id" } );
            return;
        }
        else {
			var room = chatRooms[roomId];
			var user = users[socket.id];
			console.log(user.username + " want to join room "  + room.name);
            if (userBlockedFromRoom(room, user)) {
                console.log("blocked");
				callback( { success : false, message: "You are Blocked by the room owner" } );
				return;
			}else if (userInRoom(room, user)) {
                console.log("already in room"+room.name);
				callback( { success : false, message: "You already in room " + room.name } );
                return;		
			}
            else{
            if(room.needPassword) {
                console.log("need pwd");
                
				var password = data["password"];
				if (password != room.password) {
                    console.log("incorrect pwd");
					callback( { success : false, message: "Password is incorrect" } );
					return;
				}
            }
                
            removeUserFromAllRooms(chatRooms, user);
            socket.room = room.name;
            console.log("join room"+socket.room);
            socket.join(socket.room);
            room.addUser(user);
            console.log(socket.username + " joined chat room " + socket.room);

            callback( { success : true } );			

            io.sockets.in(socket.room).emit('update_room_users', { room: room } );
            io.sockets.in(socket.room).emit('update_Blocked_users', { room: room } );
            io.sockets.in(room.name).emit('message_to_client', { chat_history: chatHistory[room.id] } );
            io.sockets.emit("update_chat_rooms", { rooms: chatRooms } );
        
        
            }
		} 
	})
    //remove user
    socket.on('remove_user', function(data) {
		var roomId = data["room_id"];
		var userId = data["user_id"];

		var room = chatRooms[roomId];
		var removedUser = users[userId];
		var currentUser = users[socket.id];

		if (room.owner.id === currentUser.id)  {
			room.removeUser(removedUser);
			var socketOfRemovedUser = connections[removedUser.id];
			socketOfRemovedUser.leave(socketOfRemovedUser.room);

			io.sockets.in(socket.room).emit('update_room_users', { room: room } );
			socketOfRemovedUser.emit('update_room_users', { room: room } );
			io.sockets.emit("update_chat_rooms", { rooms: chatRooms } );
		}
	});

    //block user
    socket.on('block_user', function(data, callback) {
		var roomId = data["room_id"];
		var userId = data["user_id"];

		var room = chatRooms[roomId];
        console.log("block user from "+room);
		var userToBlock = users[userId];
		var currentUser = users[socket.id];

		// if currentUser is allowed to block the userToBlock, then block
		if ( room.owner.username === currentUser.username )  {
            console.log("owner "+ room.owner.username);
			console.log("block user " + userToBlock.username + " with id " + userToBlock.id);
			// also have to remove user
			room.removeUser(userToBlock);
			room.blockUser(userToBlock);
			var socketOfUserToBlock = connections[userToBlock.id];
			socketOfUserToBlock.leave(socketOfUserToBlock.room);
			console.log("blocked user leaving room"+room.name);
			callback( { success : true , message: "success block"} );

			io.sockets.in(socket.room).emit('update_room_users', { room: room } );
			io.sockets.in(socket.room).emit('update_blocked_users', { room: room } );

			console.log(socketOfUserToBlock);
			socketOfUserToBlock.emit('user_blocked', { room: room } );

			io.sockets.emit("update_chat_rooms", { rooms: chatRooms } );
		} else {
			callback( { success : false, message : "You must own the room to block a user" } );
		}
	});
    //message
    socket.on('message_to_server', function(data) {
		var room = chatRooms[data["room"]];
		var messageText = data["message"];
		var sentAt = data["sent_at"];
		var user = users[socket.id];

		console.log(user.username + ": " + messageText + " in room " + room.name + " at " + sentAt);
		
		if (!chatHistory.hasOwnProperty(room.id)) {
			// create new chat history
			chatHistory[room.id] = [];
		}

		// add the message to the history
		var message = new Message(user, messageText, room.id, sentAt);
		var history = chatHistory[room.id];
		history.push(message);
		
		io.sockets.in(room.name).emit('message_to_client', { chat_history: history } );
	});

	socket.on('private_message_to_server', function(data) {
		var room = chatRooms[data["room"]];
        var user = users[socket.id];
		var messageText = data["message"];
		var sentAt = data["sent_at"];
		var toUserId = data["to_user_id"];
		var toUser = users[toUserId];

		console.log(user.username + ": " + messageText + " in room " + room.name + " at " + sentAt + " to user " + toUserId);
        if (user.username.localeCompare(toUser.username)==-1){
            var pairId = user.username + toUser.username
        }
        else if(user.username.localeCompare(toUser.username)==1){
            var pairId = toUser.username + user.username

        }
		console.log(pairId);

		if (!privateMessages.hasOwnProperty(pairId)) {
			// create new chat history
			privateMessages[pairId] = [];
		}

		// add the message to the history
		var message = new Message(user, messageText, room.id, sentAt);
		message.isPrivate = true;
		message.toUser = toUser;

		if (userInRoom(room, toUser)) {
			var socketOfUserToMessage = connections[toUserId];
			console.log(toUserId);
			console.log(connections);
			var history = privateMessages[pairId];
			history.push(message);
			
			socketOfUserToMessage.emit('private_message_to_client', { chat_history: history } );
			socket.emit('private_message_to_client', { chat_history: history } );
		} else {
			console.log("cannot send private message to user " + message.toUserId);
		}
		
	});



});

//ChatRoom class
function ChatRoom(id, name, owner) {
	this.id = id;
	this.name = name;
	this.owner = owner;
	this.users = [];
	this.blockedUsers = [];
	this.needPassword = false;
	this.password = null;
}
ChatRoom.prototype.isAvailable = function() {
  return this.available === "available";
};
ChatRoom.prototype.isNeedPassword = function() {
  return this.needPassword;
};
ChatRoom.prototype.getActiveUserCount = function() {
  return this.users.length;
};
ChatRoom.prototype.addUser = function(user) {
	for (var i = 0; i < this.users.length; i++) {
	    if (this.users[i].id == user.id) {
	        return;
	    }
	}
	this.users.push(user);
}
ChatRoom.prototype.removeUser = function(user) {
	for (var i = 0; i < this.users.length; i++) {
	    if (this.users[i].id == user.id) {
	        this.users.splice(i, 1);
	        break;
	    }
	}
}
ChatRoom.prototype.blockUser = function(user) {
	for (var i = 0; i < this.blockedUsers.length; i++) {
	    if (this.blockedUsers[i].id == user.id) {
	        break;
	    }
	}
	this.blockedUsers.push(user);
}

function userInRoom(room, user) {
    for (var i = 0; i < room.users.length; i++) {
                if (room.users[i].id === user.id) {
                    return true;
                }
            }
    return false;
}

function removeUserFromAllRooms(rooms, user) {
	for (var i = 0; i < rooms.length; i++) {
		var room = rooms[i];
		if (userInRoom(room, user)) {
			room.removeUser(user);		
		}
	}
}

function userBlockedFromRoom(room, user) {
    for (var i = 0; i < room.blockedUsers.length; i++) {
        if (room.blockedUsers[i].id === user.id) {
            return true;
        }
    }
    return false;
	
}
//User class
function User(id, username) {
	this.id = id;
	this.username = username;
}
User.prototype.getId = function() {
	return this.id;
};
User.prototype.getUsername = function() {
	return this.username;
};
//Message class
function Message(user, text, chatRoomId, sentAt){
	this.user = user; 
	this.text = text;
	this.chatRoomId = chatRoomId;
	this.sentAt = sentAt;
	this.isPrivate = false;
	this.toUser = ""; 
}
Message.prototype.getText = function() {
	return this.text;
};
Message.prototype.getSentAt = function() {
	return this.sentAt;
};

