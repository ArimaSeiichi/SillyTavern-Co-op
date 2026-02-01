// IIFE to encapsulate the extension's logic
(function() {
    // 1. Extension setup
    const extensionName = "SillyTavern-Coop";
    const settings = {};
    let ws = null;
    let userId = `user_${Math.random().toString(36).substring(2, 9)}`;
    let isHost = false;
    let pendingInputs = new Map(); // For the host to collect inputs
    
    // Using a proxy to communicate with the UI store safely
    const coopUi = new Proxy({}, {
        get(_, prop) {
            return (...args) => {
                const store = window.coopStore;
                if (store && typeof store[prop] === 'function') {
                    store[prop](...args);
                }
            };
        },
    });

    // 2. Settings and Initialization
    async function loadSettings() {
        // In ST, this would be: const config = await getExtensionConfig(extensionName);
        // For now, we simulate it.
        const config = {
            enabled: true,
            server_url: 'ws://localhost:8080',
            user_name: 'User'
        };
        Object.assign(settings, config);
        console.log(`${extensionName}: Settings loaded.`, settings);
    }
    
    // 3. WebSocket Core Logic
    function connect() {
        if (ws && ws.readyState === WebSocket.OPEN) return;
        if (!settings.server_url) {
            coopUi.setStatus('disconnected');
            coopUi.log('Error: Server URL is not configured.');
            return;
        }
        
        coopUi.setStatus('connecting');
        ws = new WebSocket(settings.server_url);

        ws.onopen = () => {
            coopUi.setStatus('connected');
            ws.send(JSON.stringify({
                type: 'join',
                data: { id: userId, name: settings.user_name }
            }));
        };

        ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
        ws.onclose = () => {
            ws = null;
            isHost = false;
            coopUi.setStatus('disconnected');
            coopUi.log('Connection to server closed.');
        };
        ws.onerror = (err) => {
            console.error(`${extensionName} WebSocket Error:`, err);
            coopUi.setStatus('disconnected');
            coopUi.log('Error: Could not connect to server.');
        };
    }

    function disconnect() {
        if (ws) ws.close();
    }

    // 4. Message Handling
    function handleMessage(message) {
        console.log(`${extensionName}: Received`, message);
        switch (message.type) {
            case 'welcome':
                userId = message.data.id;
                isHost = message.data.isHost;
                coopUi.setIsHost(isHost);
                coopUi.log(`Joined as ${isHost ? 'Host' : 'Client'}.`);
                message.data.users.forEach(u => coopUi.addUser(u));
                break;

            case 'user_joined':
                coopUi.addUser(message.data);
                coopUi.log(`${message.data.name} has joined.`);
                break;

            case 'user_left':
                coopUi.removeUser(message.data.id);
                coopUi.log(`${message.data.name} has left.`);
                break;
            
            case 'host_input_request':
                coopUi.setStatus('waiting');
                break;

            case 'client_input':
                if (isHost) {
                    pendingInputs.set(message.data.id, message.data.text);
                    coopUi.log(`Received input from ${message.data.name}.`);
                    // Potentially update UI with who has submitted
                }
                break;

            case 'broadcast_message':
                // This is the AI's final response, broadcast by the host
                if (!isHost) {
                    // Client adds the message to their chat UI without triggering AI
                    addOneMessage({
                        role: 'assistant',
                        message: message.data.text,
                        send_date: Date.now(),
                        is_system: false,
                    });
                }
                coopUi.setStatus('connected');
                break;
        }
    }
    
    // 5. Host-specific Actions
    async function sendCombinedInputsToAI() {
        if (!isHost || pendingInputs.size === 0) return;

        let combinedMessage = Array.from(pendingInputs.values()).join('\n\n');
        pendingInputs.clear();
        coopUi.setStatus('generating');

        // This sends the combined message to the local SillyTavern AI
        const chat = await sendSystemMessage({
            message: combinedMessage,
            role: 'user',
            is_user: true,
        });

        // After AI responds, the 'after_user_message' event will trigger,
        // which we'll use to broadcast the result.
    }

    // 6. SillyTavern Event Hooking
    async function onBeforeMessageSend(data) {
        // If the extension is not active, let the message pass through
        if (!settings.enabled || !ws || ws.readyState !== WebSocket.OPEN) {
            return true;
        }

        const messageText = data.message;
        
        if (isHost) {
            // Host intercepts their own message and stores it
            pendingInputs.set(userId, messageText);
            coopUi.log('Your input is ready. Waiting for others...');
            // In a real implementation, a "Send to AI" button in the UI would call sendCombinedInputsToAI
            // For now, let's just log it. A timeout could also trigger it.
            setTimeout(sendCombinedInputsToAI, 5000); // Send after 5s for demo
        } else {
            // Client sends their input to the host via the server
            ws.send(JSON.stringify({
                type: 'user_input',
                data: { id: userId, name: settings.user_name, text: messageText },
            }));
            coopUi.log('Your input has been sent to the host.');
        }

        // VERY IMPORTANT: Prevent the original message from being processed by SillyTavern
        data.message = ''; // Empty the message
        data.abort = true; // Stop processing
        return false;
    }
    
    async function onAfterMessageGenerate(data) {
        // This event fires after the AI has generated a response.
        // Only the host should act on this.
        if (isHost && ws && ws.readyState === WebSocket.OPEN) {
            const lastMessage = getChatMessages(data.message_id)[0];
            if (lastMessage && lastMessage.role === 'assistant') {
                // Broadcast the AI's response to all clients
                ws.send(JSON.stringify({
                    type: 'broadcast_ai_response',
                    data: { text: lastMessage.message }
                }));
                coopUi.setStatus('connected');
            }
        }
    }


    // 7. Initialize Extension
    (async function() {
        await loadSettings();
        if (!settings.enabled) {
            console.log(`${extensionName}: Extension is disabled.`);
            return;
        }
        
        const interval = setInterval(() => {
            // Wait for SillyTavern's API and the UI to be ready
            if (window.tavern && window.coopStore) {
                clearInterval(interval);
                
                tavern.eventSource.on('before_send_user_message', (data) => {
                    if (!onBeforeMessageSend(data)) {
                        data.abort = true;
                    }
                });
                tavern.eventSource.on('character_message_rendered', onCharacterMessageRendered);
                
                document.addEventListener('coop-connect', connect);
                document.addEventListener('coop-disconnect', disconnect);
                document.addEventListener('coop-request-inputs', requestInputsFromClients);
                document.addEventListener('coop-send-to-ai', sendCombinedInputsToAI);
                document.addEventListener('coop-submit-input', (event) => {
                     if (!isHost && ws) {
                        ws.send(JSON.stringify({
                            type: 'user_input',
                            data: { id: userId, name: settings.user_name, text: event.detail.text },
                        }));
                        coopUi.log('System: Your input was sent to the host.');
                    }
                });

                console.log(`${extensionName}: Fully initialized.`);
                coopUi.log('System: Co-op extension loaded. Connect to a server to begin.');
            }
        }, 200);
    })();

})();
