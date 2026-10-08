// Browser half of dsh-plugin-session-delete: the Session "..." menu row and the
// confirmation dialog that gates it. No transcript content is read or retained —
// the only Host call is one deletion POST.
window.__ModuleLoader__.load({
	id: 'dsh-plugin-session-delete',
	factory: function (require) {
		'use strict';
		const React = require('react');
		const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');
		const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
		const { Button, IconTrashOutlineRegular, MenuItemButton, Modal } = primitives;
		const h = React.createElement;

		/** Locale namespace owned by this plugin. */
		const NS = 'session-delete';
		/** Authenticated Host route that performs the deletion. */
		const DELETE_ROUTE = '/api/session.delete';

		/** Simplified-Chinese copy. */
		const zh = {
			'menu.deleteSession': '删除会话',
			'dialog.title': '删除会话',
			'dialog.description': '将永久删除“{title}”及其全部会话记录，此操作不可撤销。',
			'dialog.confirm': '删除会话',
			'dialog.cancel': '取消',
			'dialog.close': '关闭',
			'dialog.pending': '正在删除会话…',
			'dialog.failed': '删除会话失败。'
		};
		/** English copy. */
		const en = {
			'menu.deleteSession': 'Delete session',
			'dialog.title': 'Delete session',
			'dialog.description': '“{title}” and its entire session record will be permanently deleted. This cannot be undone.',
			'dialog.confirm': 'Delete session',
			'dialog.cancel': 'Cancel',
			'dialog.close': 'Close',
			'dialog.pending': 'Deleting session…',
			'dialog.failed': 'Could not delete the session.'
		};

		/**
		* The shipped danger treatment for a destructive dialog action: the error
		* color while the button is enabled, exactly as "Delete workspace" uses it.
		*/
		const CSS = '.dsh-sd-danger:not(:disabled){color:var(--dsw-alias-state-error-primary)}.dsh-sd-status{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.dsh-sd-error{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}';
		const CSS_TAG_ID = 'dsh-plugin-session-delete/styles.css';
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-plugin-session-delete';
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/**
		* Read the message carried by an unknown thrown value.
		* @param error - the thrown value.
		* @returns a displayable message.
		*/
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/**
		* Ask the Host half to delete one Session and settle on its outcome.
		* @param sessionId - the Session to delete.
		* @returns the Host result payload.
		* @throws when the route rejects the request or reports a failure.
		*/
		async function requestDelete(sessionId) {
			const response = await fetch(DELETE_ROUTE, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId })
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || payload === null || payload.ok !== true) {
				throw new Error(payload?.error || 'HTTP ' + String(response.status));
			}
			return payload;
		}

		/**
		* Menu row (order 500): open the confirmation for this Session.
		*
		* A separator starts the row so the destructive action reads as its own
		* group beneath the shipped archive row (order 400).
		* @param props - owner share, dialog controls, and the locale seat.
		* @returns the row.
		*/
		function DeleteSessionMenuItem(props) {
			const { sessionId, displayTitle, useDeleteState, useMenuOpenState, request, t } = props;
			const [, setMenuOpen] = useMenuOpenState();
			const busy = useDeleteState((state) => state.busy && state.target !== null && state.target.sessionId === sessionId);
			return h(MenuItemButton, {
				icon: h(IconTrashOutlineRegular, { size: 14 }),
				danger: true,
				separatorBefore: true,
				disabled: busy,
				onSelect: () => {
					setMenuOpen(false);
					request(sessionId, displayTitle);
				},
				children: t('menu.deleteSession')
			});
		}

		/**
		* The `shell.overlay` confirmation, styled after the shipped "Delete
		* workspace" dialog: outline cancel beside a danger-colored confirm, a
		* pending line while the Host works, and an inline error on failure.
		* @param props - dialog controls and the locale seat.
		* @returns the modal, or null while no deletion is staged.
		*/
		function DeleteSessionDialog(props) {
			const { useDeleteState, confirm, dismiss, t } = props;
			const state = useDeleteState((value) => value);
			const target = state.target;
			return h(Modal, {
				open: target !== null,
				onClose: dismiss,
				closeLabel: t('dialog.close'),
				title: t('dialog.title'),
				...(target === null ? {} : { description: t('dialog.description', { title: target.title }) }),
				footer: h(
					React.Fragment,
					null,
					h(
						Button,
						{ key: 'cancel', variant: 'outline', disabled: state.busy, onClick: dismiss },
						t('dialog.cancel')
					),
					h(
						Button,
						{
							key: 'confirm',
							variant: 'outline',
							className: 'dsh-sd-danger',
							disabled: state.busy,
							onClick: confirm
						},
						t('dialog.confirm')
					)
				),
				children: h(
					React.Fragment,
					null,
					state.busy ? h('div', { key: 'status', className: 'dsh-sd-status', role: 'status' }, t('dialog.pending')) : null,
					state.error !== null ? h('div', { key: 'error', className: 'dsh-sd-error', role: 'alert' }, state.error) : null
				)
			});
		}

		/** Services this browser half needs before it applies. */
		const inject = ['slots', 'locale'];

		/**
		* Register the Session menu row and its confirmation dialog.
		* @param ctx - browser context carrying slots and locale.
		*/
		function apply(ctx) {
			/** Staged deletion shared by the menu row and the dialog. */
			const store = createSnapshotStore({ target: null, busy: false, error: null });
			ctx.effect(
				() =>
					ctx.locale.register(NS, {
						zh,
						en
					}),
				'session-delete: dictionaries'
			);

			/** Stage one Session and open the confirmation. */
			const request = (sessionId, title) => {
				store.update((draft) => {
					draft.target = { sessionId, title: typeof title === 'string' ? title : '' };
					draft.busy = false;
					draft.error = null;
				});
			};
			/** Close the confirmation without deleting; ignored while a delete is in flight. */
			const dismiss = () => {
				if (store.getSnapshot().busy) return;
				store.update((draft) => {
					draft.target = null;
					draft.error = null;
				});
			};
			/** Run the staged deletion and settle the dialog on its outcome. */
			const confirm = async () => {
				const state = store.getSnapshot();
				const target = state.target;
				if (target === null || state.busy) return;
				store.update((draft) => {
					draft.busy = true;
					draft.error = null;
				});
				try {
					await requestDelete(target.sessionId);
					store.update((draft) => {
						draft.target = null;
						draft.busy = false;
						draft.error = null;
					});
				} catch (error) {
					const failed = messageOf(error);
					store.update((draft) => {
						draft.busy = false;
						draft.error = failed;
					});
				}
			};

			ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
				ctx.slots.register(
					{
						name: 'sidebar.workspaces.session.menu.item',
						id: 'session-delete.delete',
						order: 500,
						locale: NS,
						inject: () => ({ hooks: { deleteState: store }, request })
					},
					DeleteSessionMenuItem
				)
			);
			ctx.slots.inject('shell.overlay', () =>
				ctx.slots.register(
					{
						name: 'shell.overlay',
						id: 'session-delete.confirm',
						locale: NS,
						inject: () => ({ hooks: { deleteState: store }, confirm, dismiss })
					},
					DeleteSessionDialog
				)
			);
		}

		return { inject, apply };
	}
});
