require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const axios = require('axios');

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => {
    res.render('index');
});

// Store conversation history for each socket
const conversations = new Map();

async function evaluateMessage(message) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            messages: [
                {
                    role: "system",
                    content: "You are an English language evaluator. Your job is to check if the given English sentence is natural and correct. If you find any unnatural expressions or mistakes, provide a brief tip starting with 'Tip!'. If the sentence is perfectly natural, just respond with 'OK'. Keep your tips concise and helpful."
                },
                {
                    role: "user",
                    content: message
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Evaluation Error:', error);
        return null;
    }
}

async function getConversationResponse(history) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            messages: [
                {
                    role: "system",
                    content: "You are a friendly and casual English conversation partner. Use very informal, everyday English like you're chatting with a close friend. Feel free to use slang, contractions, and casual expressions. Keep your responses short and fun. Don't be too formal or academic. Be encouraging and use emojis sometimes! 😊"
                },
                ...history.slice(-5)
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Conversation Error:', error);
        return null;
    }
}

io.on('connection', (socket) => {
    console.log('A user connected');
    
    // Initialize conversation history for this socket
    conversations.set(socket.id, []);

    socket.on('chat message', async (msg) => {
        try {
            // Get conversation history for this socket
            const history = conversations.get(socket.id);
            
            // Add user message to history
            history.push({ role: "user", content: msg });

            // Evaluate the message for tips
            const evaluation = await evaluateMessage(msg);
            if (evaluation && evaluation.includes('Tip!')) {
                socket.emit('tip', evaluation);
            }

            // Get conversation response
            const aiResponse = await getConversationResponse(history);
            if (aiResponse) {
                // Add AI response to history
                history.push({ role: "assistant", content: aiResponse });
                
                // Keep only last 10 messages to prevent history from growing too large
                if (history.length > 10) {
                    history.splice(0, history.length - 10);
                }
                
                conversations.set(socket.id, history);
                socket.emit('chat response', aiResponse);
            }
        } catch (error) {
            console.error('Error:', error);
            socket.emit('chat response', 'Sorry, I encountered an error. Please try again.');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        // Clean up conversation history when user disconnects
        conversations.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 