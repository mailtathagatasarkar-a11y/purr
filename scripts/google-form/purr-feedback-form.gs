/**
 * Purr feedback: a Google Form whose answers are filed as GitHub issues, where
 * the daily feedback agent picks them up. Runs in your Google account; nothing
 * here needs a server.
 *
 * One-time setup (about 3 minutes):
 *  1. Go to https://script.google.com, click "New project", and paste this whole file.
 *  2. Make a GitHub token that can only file issues on Purr:
 *     github.com -> Settings -> Developer settings -> Fine-grained tokens -> Generate.
 *     Repository access: only "purr". Permissions: Issues -> Read and write. Nothing else.
 *  3. In the script editor: Project Settings (gear) -> Script properties -> Add property
 *     GITHUB_TOKEN = the token. Save.
 *  4. Pick "setup" in the function menu and click Run. Approve the Google permissions.
 *     The execution log prints the link to share.
 *
 * Answers become public GitHub issues, and the form says so.
 */

const REPO = 'mailtathagatasarkar-a11y/purr';

function setup() {
  const form = FormApp.create('Purr feedback');
  form
    .setDescription(
      'Tell us what worked, what broke, or what you wish Purr did. Answers are posted publicly on ' +
        'GitHub (github.com/' + REPO + '/issues) so they can be fixed in the open, so please leave out ' +
        'personal details and API keys. No sign-in needed.'
    )
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false)
    .setConfirmationMessage('Thanks! Your feedback is now an issue on GitHub, and fixes ship in the next release.');

  form.addMultipleChoiceItem()
    .setTitle('What were you doing?')
    .setChoiceValues([
      'Installing or opening Purr',
      'Dictating (holding the shortcut and talking)',
      'Hands-free dictation',
      'Command Mode',
      'Transforms (Polish, Prompt Engineer)',
      'Notes',
      'Settings or model downloads',
      'Something else'
    ])
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('What happened?')
    .setHelpText('If Purr typed something wrong, write what you said and what it typed.')
    .setRequired(true);
  form.addParagraphTextItem().setTitle('What did you expect?');
  form.addMultipleChoiceItem()
    .setTitle('Computer')
    .setChoiceValues(['Windows', 'Mac with Apple Silicon (M1 or later)', 'Mac with Intel', 'Not sure'])
    .setRequired(true);
  form.addMultipleChoiceItem()
    .setTitle('Where does Purr do the work?')
    .setChoiceValues(['On this computer (local)', 'Cloud (my own API key)', 'Not set up yet']);
  form.addTextItem().setTitle('Purr version').setHelpText('Settings → About shows it, e.g. 0.1.1');
  form.addScaleItem().setTitle('How useful is Purr for you so far?').setBounds(1, 5).setLabels("Doesn't work for me", 'I use it every day');
  form.addParagraphTextItem().setTitle('Anything else?');

  ScriptApp.newTrigger('onSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Share this link: ' + form.getPublishedUrl());
  Logger.log('Edit the form here: ' + form.getEditUrl());
}

function onSubmit(e) {
  const items = e.response.getItemResponses();
  const answer = (title) => {
    const r = items.find((i) => i.getItem().getTitle() === title);
    return r ? String(r.getResponse()) : '';
  };
  const body =
    items.map((r) => '### ' + r.getItem().getTitle() + '\n\n' + String(r.getResponse())).join('\n\n') +
    '\n\n_Submitted through the Google Form._';
  const title = '[Feedback] ' + (answer('What happened?').split('\n')[0].slice(0, 70) || answer('What were you doing?'));
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Add GITHUB_TOKEN under Project Settings → Script properties.');
  UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/issues', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ title: title, body: body, labels: ['feedback'] })
  });
}
