var mktemp = require("mktemp");
var gm = require("gm").subClass({
    imageMagick: true
});
var async = require("async");
var AWS = require("aws-sdk");
var fs = require("fs");

var THUMB_WIDTH = 150;
var THUMB_HEIGHT = 150;

var s3 = new AWS.S3();

exports.handler = (event, context, callback) => {
    var message = event['Records'][0]['Sns']['Message']
    console.log(message);

    var page = message[''];
    var srcBucket = message[''];
    var dstBucket = 'desnouckuploadsresized';
    var srcKey = message[''];

    async.waterfall([
            function download(next) {
                //Download the pdf from S3
                s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                }, next);
            },
            function prepareTemp(response, next) {
                if (fileType === "pdf") {
                    temp_file = mktemp.createFileSync("/tmp/XXXXXXXXXX.pdf")
                    fs.writeFileSync(temp_file, response.Body);
                    next(null, temp_file);
                } else {
                    console.error("Filetype " + fileType + " not valid for this function, exiting");
                    return;
                }
            },
            function createThumbnail(response, next) {
                var temp_file, image;

                if (fileType === "pdf") {
                    temp_file = mktemp.createFileSync("/tmp/XXXXXXXXXX.pdf")
                    fs.writeFileSync(temp_file, response.Body);
                    image = gm(temp_file + "[" + page + "]");
                } else {
                    image = gm(response.Body);
                }

                image.size(function(err, size) {
                    var scalingFactor = Math.min(1, THUMB_WIDTH / size.width, THUMB_HEIGHT / size.height),
                        width = Math.round(scalingFactor * size.width),
                        height = Math.round(scalingFactor * size.height);

                    var dstKeyExt = '-' + page + '-' + width + 'x' + height + '.png';
                    dstKey = srcKey.replace(/\.\w+$/, dstKeyExt);

                    this.resize(width, height)
                        .toBuffer("png", function(err, buffer) {
                            if (temp_file) {
                                fs.unlinkSync(temp_file);
                            }

                            if (err) {
                                next(err);
                            } else {
                                next(null, response.contentType, buffer);
                            }
                        });
                });
            },
            function uploadThumbnail(contentType, data, next) {
                s3.putObject({
                    Bucket: dstBucket,
                    Key: dstKey,
                    Body: data,
                    ContentType: "image/png",
                    Metadata: {
                        thumbnail: 'TRUE'
                    }
                }, next);
            }

        ],
        function(err) {
            if (err) {
                console.error(
                    "Unable to generate thumbnails for '" + srcBucket + "/" + srcKey + "'" +
                    " due to error: " + err
                );
            } else {
                console.log("Created thumbnails for '" + srcBucket + "/" + srcKey + "'");
            }

            context.done();
        });
};
