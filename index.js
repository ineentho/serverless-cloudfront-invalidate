'use strict';

const AWS = require('aws-sdk');
const randomstring = require('randomstring');
const chalk = require('chalk');
const fs = require('fs');
const https = require('https');

class CloudfrontInvalidate {

  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};

    if (this.options.cacert) {
      this.handleCaCert(this.options.cacert);
    }

    this.commands = {
      cloudfrontInvalidate: {
        usage: "Invalidate Cloudfront Cache",
        lifecycleEvents: [
          'invalidate'
        ]
      }
    };

    this.hooks = {
      'after:deploy:deploy': this.invalidate.bind(this),
      'cloudfrontInvalidate:invalidate': this.invalidate.bind(this),
    };
  }

  handleCaCert(caCert) {
    const cli = this.serverless.cli;

    if (!fs.existsSync(caCert)) {
      throw new Error("Supplied cacert option to a file that does not exist: " + caCert);
    }

    AWS.config.update({
      httpOptions: { agent: new https.Agent({ ca: fs.readFileSync(caCert)}) }
    });

    cli.consoleLog(`CloudfrontInvalidate: ${chalk.yellow('ca cert handling enabled')}`);
  }

  createInvalidation(distributionId, reference, awsCredentials) {
    const cli = this.serverless.cli;
    const cloudfrontInvalidateItems = this.serverless.service.custom.cloudfrontInvalidate.items;
    const cloudfront = new AWS.CloudFront({
      credentials: awsCredentials.credentials
    });

    const params = {
      DistributionId: distributionId, /* required */
      InvalidationBatch: { /* required */
        CallerReference: reference, /* required */
        Paths: { /* required */
            Quantity: cloudfrontInvalidateItems.length, /* required */
            Items: cloudfrontInvalidateItems
        }
      }
    };
    return cloudfront.createInvalidation(params).promise().then(
      () => {
        cli.consoleLog(`CloudfrontInvalidate: ${chalk.yellow('Invalidation started')}`);
      },
      err => {
        console.log(JSON.stringify(err));
        cli.consoleLog(`CloudfrontInvalidate: ${chalk.yellow('Invalidation failed')}`);
        throw err;
      }
    );
  }

  invalidate() {
    const cli = this.serverless.cli;
    let cloudfrontInvalidate = this.serverless.service.custom.cloudfrontInvalidate;
    let reference = randomstring.generate(16);
    let distributionId = cloudfrontInvalidate.distributionId;
    const awsCredentials = this.serverless.getProvider('aws').getCredentials();

    if (distributionId) {
      cli.consoleLog(`DistributionId: ${chalk.yellow(distributionId)}`);
      return this.createInvalidation(distributionId, reference, awsCredentials);
    } 

    if (!cloudfrontInvalidate.distributionIdKey) {
      cli.consoleLog('distributionId or distributionIdKey is required');
      return;
    }

    cli.consoleLog(`DistributionIdKey: ${chalk.yellow(cloudfrontInvalidate.distributionIdKey)}`);

    // get the id from the output of stack.
    const cfn = new AWS.CloudFormation({
      credentials: awsCredentials.credentials,
      region: this.serverless.getProvider('aws').getRegion()
    });
    const stackName = this.serverless.getProvider('aws').naming.getStackName()

    return cfn.describeStacks({ StackName: stackName }).promise()
      .then(result => {
        if (result) {
          const outputs = result.Stacks[0].Outputs;
          outputs.forEach(output => {
            if (output.OutputKey === cloudfrontInvalidate.distributionIdKey) {
              distributionId = output.OutputValue;
            }
          });
        }
      })
      .then(() => this.createInvalidation(distributionId, reference, awsCredentials))
      .catch(error => {
        cli.consoleLog('Failed to get DistributionId from stack output. Please check your serverless template.');
        return;
      });
  }
}

module.exports = CloudfrontInvalidate;
