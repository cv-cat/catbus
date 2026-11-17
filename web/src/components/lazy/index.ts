import { lazyComponent } from '@/composables/lazy'

/*
 * 按需加载的页面和浮层（首屏只带发现页）。页面在进入时加载；
 * 详情卡片、登录、设置等浮层在首屏之后空闲时预取（App.vue），详情卡片在悬停卡片时也会预取，
 * 第一次打开时代码已经在了，共享元素放大动画照常从卡片的位置开始。
 */
export const LazyAuthorView = lazyComponent(() => import('@/views/AuthorView.vue'))
export const LazyRailView = lazyComponent(() => import('@/views/RailView.vue'))
export const LazyMteamMeView = lazyComponent(() => import('@/views/MteamMeView.vue'))
export const LazyMineView = lazyComponent(() => import('@/views/MineView.vue'))
export const LazyLocalView = lazyComponent(() => import('@/views/LocalView.vue'))
export const LazyLiveView = lazyComponent(() => import('@/views/LiveView.vue'))
export const LazySubsView = lazyComponent(() => import('@/views/SubsView.vue'))
export const LazyInboxView = lazyComponent(() => import('@/views/InboxView.vue'))

export const LazyDetailCard = lazyComponent(() => import('@/components/DetailCard.vue'))
export const LazyLightbox = lazyComponent(() => import('@/components/Lightbox.vue'))
export const LazyLoginDialog = lazyComponent(() => import('@/components/LoginDialog.vue'))
export const LazyVerifyDialog = lazyComponent(() => import('@/components/VerifyDialog.vue'))
export const LazySettingsDialog = lazyComponent(() => import('@/components/settings/SettingsDialog.vue'))
export const LazyGroupMenu = lazyComponent(() => import('@/components/local/GroupMenu.vue'))
export const LazyDownloadPanel = lazyComponent(() => import('@/components/DownloadPanel.vue'))
