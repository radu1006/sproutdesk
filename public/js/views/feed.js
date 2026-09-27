'use strict';

/**
 * Class feed: photo and text updates educators post to a classroom.
 * Families see the posts of their children's classrooms only.
 */

import { api } from '../api.js';
import * as store from '../state.js';
import * as ui from '../ui.js';

/** Composer used by staff: photo upload plus a short note. */
function composer({ onPosted }) {
  const attachment = { url: '', type: 'none' };

  const classroom = ui.select({
    name: 'classroomId',
    required: true,
    placeholder: 'Select a classroom',
    options: store.classroomOptions(),
  });
  const title = ui.input({ name: 'title', maxlength: 140, placeholder: 'Optional headline' });
  const body = ui.textarea({ name: 'body', rows: 3, placeholder: 'A short note for the families…' });
  const file = ui.el('input', { class: 'input', type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
  const preview = ui.el('span', { class: 'muted small', text: 'No photo attached' });

  file.addEventListener('change', async () => {
    const chosen = file.files && file.files[0];
    if (!chosen) return;
    try {
      const uploaded = await api.upload('/uploads', chosen);
      attachment.url = uploaded.url;
      attachment.type = 'image';
      ui.mount(preview, ui.el('span', { class: 'muted small', text: 'Photo attached.' }));
    } catch (error) {
      attachment.url = '';
      attachment.type = 'none';
      ui.notify.error(error.message || 'The photo could not be uploaded.');
    } finally {
      file.value = '';
    }
  });

  const element = ui.form(
    [
      ui.field('Classroom', classroom),
      ui.field('Headline', title),
      ui.field('Update', body, 'Families of this classroom are notified in their feed.'),
      ui.field('Photo', file),
      ui.el('div', { class: 'form-grid' }, preview),
    ],
    {
      submitLabel: 'Post update',
      onSubmit: async (values) => {
        await api.post('/posts', {
          classroomId: Number(values.classroomId),
          title: values.title,
          body: values.body,
          mediaUrl: attachment.url || undefined,
          mediaType: attachment.type,
        });
        ui.notify.ok('Posted to the class feed.');
        element.reset();
        attachment.url = '';
        attachment.type = 'none';
        ui.mount(preview, ui.el('span', { class: 'muted small', text: 'No photo attached' }));
        onPosted();
      },
    },
  );

  return element;
}

/** A single feed entry. */
function postCard({ post, canManage, onChanged }) {
  const media = post.mediaUrl
    ? post.mediaType === 'video'
      ? ui.el('video', { class: 'post-media', src: post.mediaUrl, controls: true })
      : ui.el('img', { class: 'post-media', src: post.mediaUrl, alt: post.title || 'Class photo', loading: 'lazy' })
    : null;

  return ui.el(
    'article',
    { class: 'card post' },
    ui.el(
      'div',
      { class: 'post-meta' },
      ui.el('strong', { text: post.authorName || 'SproutDesk' }),
      ui.el('span', { text: '·' }),
      ui.el('span', { text: post.classroomName || 'Whole centre' }),
      ui.el('span', { text: '·' }),
      ui.el('span', { text: ui.fmtRelative(post.postedAt) }),
      canManage
        ? ui.el(
            'span',
            { class: 'right' },
            ui.button('Delete', {
              kind: 'danger',
              onClick: async () => {
                const confirmed = await ui.confirmAction('Delete this post? Families will no longer see it.');
                if (!confirmed) return;
                try {
                  await api.delete(`/posts/${post.id}`);
                  ui.notify.ok('Post deleted.');
                  onChanged();
                } catch (error) {
                  ui.notify.error(error.message);
                }
              },
            }),
          )
        : null,
    ),
    post.title ? ui.el('h3', { text: post.title }) : null,
    media,
    post.body ? ui.el('p', { class: 'post-body', text: post.body }) : null,
  );
}

export default async function renderFeed(container, ctx) {
  const role = ctx.user.role;
  const isStaff = role !== 'parent';
  const filters = { classroomId: isStaff ? ctx.query.classroomId || '' : '' };

  async function draw() {
    ui.mount(container, ui.loading('Loading the class feed…'));
    try {
      const posts = await api.get(
        '/posts',
        ui.compact({
          classroomId: filters.classroomId ? Number(filters.classroomId) : undefined,
          limit: 60,
        }),
      );

      const filterBox = isStaff
        ? ui.el(
            'div',
            { class: 'grid grid-2' },
            ui.field(
              'Classroom',
              ui.select({
                name: 'classroomId',
                value: filters.classroomId,
                options: store.classroomOptions({ includeAll: true }),
              }),
            ),
          )
        : null;

      if (filterBox) {
        filterBox.querySelector('select').addEventListener('change', (event) => {
          filters.classroomId = event.target.value || '';
          ctx.go('/feed', ui.compact({ classroomId: filters.classroomId || undefined }));
        });
      }

      ui.mount(
        container,
        ui.el(
          'div',
          { class: 'stack' },
          isStaff
            ? ui.card({
                title: 'Post an update',
                subtitle: 'Photos and notes reach every family of the classroom',
                body: composer({ onPosted: () => draw() }),
              })
            : null,
          filterBox ? ui.card({ title: 'Show', body: filterBox }) : null,
          posts.length
            ? ui.el(
                'div',
                { class: 'feed' },
                posts.map((post) =>
                  postCard({
                    post,
                    canManage: isStaff && (role === 'admin' || Number(post.authorId) === Number(ctx.user.id)),
                    onChanged: () => draw(),
                  }),
                ),
              )
            : ui.emptyState(
                isStaff ? 'Nothing has been posted yet.' : 'Your child’s classroom has no updates yet.',
                { hint: isStaff ? 'Use the composer above to share the first update.' : 'Updates appear here as soon as educators post them.' },
              ),
        ),
      );
    } catch (error) {
      ui.mount(container, ui.errorState(error));
    }
  }

  if (isStaff) await store.loadClassrooms().catch(() => {});
  await draw();
}

