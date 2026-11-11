import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/base.css'
import App from './App.vue'
import { tip } from './directives/tip'

createApp(App).use(createPinia()).directive('tip', tip).mount('#app')
