<template>
  <view class="container">
    <view class="card">
      <view class="title">实名认证</view>
      <view class="muted">
        实名认证是信任增强徽章，不是聊天门槛。认证后默认仅显示“实名已认证”，不展示姓名；
        他人查看你的姓名需逐次取得你的同意。
      </view>
      <view class="divider" />
      <view class="row">
        <text>状态</text>
        <text :class="status.certified ? 'ok' : 'bad'">{{ status.certified ? '实名已认证' : '未实名' }}</text>
      </view>
      <view class="row">
        <text>服务费</text>
        <text>¥ {{ feeText }}</text>
      </view>
    </view>

    <!-- 发起认证 -->
    <view v-if="!status.certified && !order" class="card">
      <view class="title">发起认证</view>
      <view class="muted">实名信息由持牌服务商核验，平台不存储证件原图。</view>
      <view class="btn-primary" @tap="apply('self')">本人支付 ¥{{ feeText }}</view>
      <view class="btn-primary ghost" @tap="apply('proxy')">请对方代付（代付人直接向平台支付）</view>
    </view>

    <!-- 订单流程 -->
    <view v-if="order" class="card">
      <view class="title">订单 {{ order.id }}</view>
      <view class="row"><text>金额</text><text>¥ {{ (order.amount / 100).toFixed(2) }}</text></view>
      <view class="row"><text>状态</text><text class="em">{{ statusLabel(order.status) }}</text></view>
      <view class="divider" />

      <!-- 被认证方：确认接受代付 -->
      <view v-if="order.status === 'created' && isPayee" class="btn-primary" @tap="acceptProxy">
        确认授权实名并接受代付
      </view>

      <!-- 付款人：勾选不可撤销 → 支付 -->
      <block v-if="isPayer && order.status === 'proxy_confirmed'">
        <view class="consent" @tap="consentChecked = !consentChecked">
          <text>{{ consentChecked ? '☑' : '☐' }} 我已知晓：认证提交后不可单方撤销或退款；认证失败按规则处理（无冷静期）。
          </text>
        </view>
        <view class="btn-primary" :class="{ disabled: !consentChecked }" @tap="pay">
          支付 ¥{{ (order.amount / 100).toFixed(2) }}（Mock）
        </view>
      </block>

      <!-- 已支付未提交：可取消（全额退） -->
      <block v-if="isPayer && order.status === 'paid'">
        <view class="btn-primary" @tap="submit">提交认证（提交后取消/退款入口关闭）</view>
        <view class="btn-warn" @tap="cancel">取消并全额退款（仅限认证未提交阶段）</view>
      </block>
      <view v-if="isPayee && order.status === 'paid'" class="btn-primary" @tap="submit">
        提交认证（提交后取消/退款入口关闭）
      </view>

      <view class="muted sub">
        退款规则：认证成功不退；提交前取消全额退；平台故障全额退；
        信息不实首次失败可退、后续不退。退款原路退回付款人。
      </view>
    </view>

    <!-- 联调：Mock 服务商结果 -->
    <view v-if="order && order.status === 'submitted' && isPayee" class="card">
      <view class="title">联调：模拟服务商结果</view>
      <view class="btn-primary" @tap="callback('success')">认证成功</view>
      <view class="btn-warn" @tap="callback('platform_error')">平台故障（全额退）</view>
      <view class="btn-warn" @tap="callback('info_false')">信息不实失败</view>
    </view>
  </view>
</template>

<script>
import { api } from '@/api';
import { userStore } from '@/store/user';

const STATUS_LABEL = {
  created: '待被认证方确认',
  proxy_confirmed: '待付款人支付',
  paid: '已支付（认证未提交，可取消）',
  submitted: '认证已提交（不可撤销）',
  success: '认证成功（不退）',
  failed_info_first: '信息不实失败（首次·可退）',
  failed_info_repeat: '信息不实失败（再次·不退）',
  failed_platform: '平台故障（全额退）',
  cancelled: '已取消（全额退）'
};

export default {
  data() {
    return { status: { certified: false, fee: {} }, order: null, consentChecked: false };
  },
  computed: {
    feeText() {
      const fee = this.status.fee || {};
      return ((fee.amount || 0) / 100).toFixed(2);
    },
    isPayer() {
      return this.order && userStore.profile && this.order.payerUserId === userStore.profile.id;
    },
    isPayee() {
      return this.order && userStore.profile && this.order.payeeUserId === userStore.profile.id;
    }
  },
  async onShow() {
    await this.refresh();
  },
  methods: {
    statusLabel(s) { return STATUS_LABEL[s] || s; },
    async refresh() {
      const res = await api.realnameStatus();
      this.status = res.data;
      const inFlight = (res.data.orders || []).find(o => !['success', 'cancelled', 'failed_info_repeat', 'failed_platform'].includes(o.status) && !o.status.startsWith('failed'));
      const any = (res.data.orders || []).slice(-1)[0];
      this.order = inFlight || null;
      if (!this.order && any && ['failed_info_first'].includes(any.status)) this.order = any;
    },
    async apply(payer) {
      let proxyUserId;
      if (payer === 'proxy') {
        const m = await new Promise(resolve =>
          uni.showModal({ title: '代付人账号 ID', editable: true, placeholderText: '如 u_alice（联调用）', success: resolve })
        );
        if (!m.confirm || !m.content) return;
        proxyUserId = m.content.trim();
      }
      const res = await api.realnameApply(payer, proxyUserId);
      await this.refresh();
      uni.showToast({ title: '订单已创建', icon: 'success' });
    },
    async acceptProxy() {
      await api.realnameAcceptProxy(this.order.id);
      this.refresh();
    },
    async pay() {
      if (!this.consentChecked) {
        uni.showToast({ title: '请先勾选确认条款', icon: 'none' });
        return;
      }
      await api.orderConsent(this.order.id);
      await api.orderPay(this.order.id);
      this.refresh();
    },
    async submit() {
      uni.showModal({
        title: '确认提交',
        content: '提交至实名服务商后，取消与退款入口将关闭（无冷静期）。确认提交？',
        success: async (m) => {
          if (!m.confirm) return;
          await api.orderSubmit(this.order.id);
          this.refresh();
        }
      });
    },
    async cancel() {
      const res = await api.orderCancel(this.order.id);
      uni.showToast({ title: res.message || '已取消', icon: 'none' });
      this.refresh();
    },
    async callback(result) {
      const res = await api.orderProviderCallback(this.order.id, result);
      uni.showToast({ title: res.message || '已处理', icon: 'none' });
      this.refresh();
    }
  }
};
</script>

<style>
.title { font-size: 32rpx; font-weight: 600; margin-bottom: 12rpx; }
.row { display: flex; justify-content: space-between; margin: 10rpx 0; }
.ok { color: #09BB07; }
.bad { color: #E64340; }
.em { color: #B26A00; }
.sub { margin-top: 16rpx; }
.ghost { background: #F8F8F8; color: #576B95; }
.consent {
  background: #FFF8E1; border-radius: 12rpx; padding: 20rpx;
  font-size: 24rpx; color: #B26A00; margin: 16rpx 0; line-height: 1.6;
}
</style>
