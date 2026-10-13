const fs = require('node:fs/promises');
const path = require('node:path');
const { packageVersion, validateTag, verifyDownloads, releaseNotes } = require('../../scripts/release-utils.cjs');

module.exports = async ({ github, context, core, directory = path.resolve('release-assets') }) => {
  const version = packageVersion(path.resolve(__dirname, '../..'));
  const tag = context.ref.replace(/^refs\/tags\//, '');
  validateTag(tag, version);
  // Verify all six files before touching the remote release.
  const files = await verifyDownloads(directory, version);
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  // getReleaseByTag only guarantees published releases. List with write access
  // also includes drafts, so a rerun cannot silently create duplicate drafts.
  const matches = (await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 }))
    .filter(release => release.tag_name === tag);
  if (matches.length > 1) throw new Error('Multiple releases exist for this tag; resolve them manually before rerunning');
  let release = matches[0];
  if (release && !release.draft) throw new Error('Refusing to overwrite an already published release');
  if (!release) {
    release = (await github.rest.repos.createRelease({
      ...repo,
      tag_name: tag,
      target_commitish: context.sha,
      name: `Traceweft ${tag}`,
      body: releaseNotes(version),
      draft: true,
      prerelease: version.includes('-'),
    })).data;
  }
  // Reruns replace only matching draft assets, preserving maintainer-written notes.
  const existing = await github.paginate(github.rest.repos.listReleaseAssets, { ...repo, release_id: release.id, per_page: 100 });
  for (const name of files) {
    for (const asset of existing.filter(asset => asset.name === name)) {
      await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: asset.id });
    }
    await github.rest.repos.uploadReleaseAsset({
      ...repo,
      release_id: release.id,
      name,
      data: await fs.readFile(path.join(directory, name)),
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
  core.info(`Draft ready: ${release.html_url}. Complete installation checks before publishing.`);
};
