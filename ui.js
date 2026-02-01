// Import Vue and other libraries. SillyTavern provides these.
import {
    createApp,
    ref,
    reactive,
    computed,
    watch,
    onMounted
} from 'https://testingcf.jsdelivr.net/npm/vue@3.3.4/+esm';
import {
    createPinia,
    defineStore
} from 'https://testingcf.jsdelivr.net/npm/pinia@2.1.6/+esm';

// 1. Pinia Store for State Management
const useCoopStore = defineStore('coop', {
    state: () => ({
        status: 'disconnected', // disconnected, connecting, connected, waiting, generating
        isPanelVisible: false,
        users: [],
        chatLog: [],
        isHost: false,
        lastError: null,
    }),
    actions: {
        setStatus(newStatus) {
            this.status = newStatus;
        },
        setIsHost(isHost) {
            this.isHost = isHost;
        },
        showPanel() {
            this.isPanelVisible = true;
        },
        hidePanel() {
            this.isPanelVisible = false;
        },
        togglePanel() {
            this.isPanelVisible = !this.isPanelVisible;
        },
        setUsers(userList) {
            this.users = userList;
        },
        addUser(user) {
            if (!this.users.find(u => u.id === user.id)) {
                this.users.push(user);
            }
        },
        removeUser(userId) {
            const user = this.users.find(u => u.id === userId);
            if (user) {
                this.log(`System: ${user.name} has left.`);
                this.users = this.users.filter(u => u.id !== userId);
            }
        },
        log(message) {
            this.chatLog.unshift({ id: Date.now() + Math.random(), text: message });
            if (this.chatLog.length > 100) {
                this.chatLog.pop();
            }
        },
    },
});


// 2. Vue Component Definition
const CoopWidget = {
    template: `
        <div :class="['coop-widget', 'status-' + coop.status]" @click="coop.togglePanel" title="Co-op Panel">
            <div class="status-icon">{{ statusIcon }}</div>
        </div>

        <div :class="['coop-panel', { 'hidden': !coop.isPanelVisible }]">
            <div class="coop-panel-header" @mousedown="startDrag">
                <h3>Co-op Lobby</h3>
                <button @click.stop="coop.hidePanel" class="coop-btn-close">×</button>
            </div>
            <div class.coop-panel-body>
                <div class="coop-section">
                    <h4>Status: {{ coop.status }}</h4>
                    <div v-if="coop.status === 'disconnected'">
                        <button @click="connect" class="coop-btn">Connect</button>
                    </div>
                     <div v-else>
                        <button @click="disconnect" class="coop-btn">Disconnect</button>
                    </div>
                </div>

                <div class="coop-section">
                    <h4>Users ({{ coop.users.length }})</h4>
                    <ul class="coop-user-list">
                        <li v-for="user in coop.users" :key="user.id">
                            {{ user.name }}
                            <span v-if="user.id === hostId">(Host)</span>
                        </li>
                    </ul>
                </div>
                
                <div class="coop-section coop-log">
                    <h4>Log</h4>
                    <div class="coop-log-box">
                        <p v-for="entry in coop.chatLog" :key="entry.id">{{ entry.text }}</p>
                    </div>
                </div>

                <div class="coop-section" v-if="coop.isConnected">
                    <div v-if="coop.isHost">
                        <h4>Host Controls</h4>
                        <button @click="requestInputs" class="coop-btn">Request Inputs</button>
                        <button @click="sendToAI" class="coop-btn">Send to AI</button>
                    </div>
                    <div v-else>
                        <h4>Submit Input</h4>
                        <textarea v-model="clientInput" class="coop-input" placeholder="Your message..."></textarea>
                        <button @click="submitInput" class="coop-btn">Submit to Host</button>
                    </div>
                </div>
            </div>
        </div>
    `,
    setup() {
        const coop = useCoopStore();
        const clientInput = ref('');

        const statusIcon = computed(() => {
            switch (coop.status) {
                case 'disconnected': return '🔌';
                case 'connecting': return '⏳';
                case 'connected': return '🔗';
                case 'waiting': return '📝';
                case 'generating': return '🤖';
                default: return '❓';
            }
        });
        
        // Dispatch events for script.js to handle
        const dispatchCoopEvent = (eventName, detail = {}) => {
            document.dispatchEvent(new CustomEvent(eventName, { detail }));
        };

        const connect = () => dispatchCoopEvent('coop-connect');
        const disconnect = () => dispatchCoopEvent('coop-disconnect');
        const requestInputs = () => dispatchCoopEvent('coop-request-inputs');
        const sendToAI = () => dispatchCoopEvent('coop-send-to-ai');
        const submitInput = () => {
            if (clientInput.value.trim()) {
                dispatchCoopEvent('coop-submit-input', { text: clientInput.value });
                clientInput.value = '';
            }
        };

        return { coop, statusIcon, clientInput, connect, disconnect, requestInputs, sendToAI, submitInput };
    }
};

// 3. Vue App Initialization
document.addEventListener('DOMContentLoaded', () => {
    const pinia = createPinia();
    const app = createApp(CoopWidget);
    app.use(pinia);
    app.mount('#coop-status-app');

    // Make the store accessible for script.js
    window.coopStore = useCoopStore();
    // Also expose a generic event bus for simplicity
    window.coopEventBus = new EventTarget();
});
