/**
 * @file 文档链接有效性检查
 * @author xiaoerwen
 */

const childProcess = require('child_process');
const execSync = childProcess.execSync;
const path = require('path');
const fs = require('fs');
const request = require('request');

/**
 * 获取所有变动的文件,包括增(A)删(D)改(M)重命名(R)复制(C)等
 *
 * @param {string} type 文件变动类型
 * @return {Array}
 */
function getDiffFiles(type = 'admrc') {
    const DIFF_COMMAND = 'git diff --cached --name-status HEAD';
    const root = process.cwd();
    const files = execSync(DIFF_COMMAND).toString().split('\n');
    const types = type.split('').map(function (t) {
        return t.toLowerCase();
    });
    let result = [];

    files.forEach(function (file) {
        if (!file) {
            return;
        }
        let temp = file.split(/[\n\t]/);
        let status = temp[0].toLowerCase();
        let filepath = root + '/' + temp[1];
        let extName = path.extname(filepath).slice(1);

        if (types.length && ~types.indexOf(status)) {
            result.push({
                // 文件变更状态-AMDRC
                status: status,
                // 文件绝对路径
                path: filepath,
                // 文件相对路径
                subpath: temp[1],
                // 文件后缀名
                extName: extName
            });
        }
    });
    return result;
}

/**
 * 获取所有变动的 md 文件，不包括删除的文件
 *
 * @return {Array}
 */
function getDiffMdFiles() {
    return getDiffFiles().filter(item => (
        item.status !== 'd'
            && (item.extName === 'md'
                || item.extName === 'markdown')
    ));
}

/**
 * 匹配 markdown 文件里所有链接，包括图片和超链接
 *
 * @param {string} content 文件内容
 * @return {Array} 匹配内容
 */
function matchMdUrl(content) {
    const urlReg = /(\[(.[^\]]+)\]\((.[^)]+)\))/g;
    const titleReg = /\"(.[^)]+)\"/g;
    let matched = content.match(urlReg);
    if (matched && matched.length) {
        matched = matched.map(item => {
            item = item.replace(urlReg, (rs, $1, $2, $3) => {
                // 去掉链接中的 title 项
                $3 = $3.replace(titleReg, () => '');
                return $3;
            });
            return item;
        });
    }
    return matched;
}

/**
 * 判断是否 http/https 路径
 *
 * @param {string} str 链接路径
 * @return {boolean}
 */
function isHttpUrl(str) {
    const httpReg = /^https?:\/\//;
    return httpReg.test(str);
}

/**
 * 校验网络链接是否有效，通过请求是否返回200的方式
 *
 * @param {string} url 请求地址
 */
function isUrlValid(url) {
    return new Promise(resolve => {
        request({
            url,
            timeout: 10000
        }, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                resolve(1);
            }
            else {
                resolve(0);
            }
        });
    });
}

async function checkMdLink(data, mdFile) {
    const urls = matchMdUrl(data);
    let inValidUrls = [];

    if (urls && urls.length) {
        for (let url of urls) {
            if (isHttpUrl(url)) {
                // 请求是否返回200
                const isValid = await isUrlValid(url);
                if (!isValid) {
                    inValidUrls.push(url);
                }
            }
            // 本地文件
            else {
                let filepath;
                // 绝对路径
                if (path.isAbsolute(url)) {
                    filepath = path.resolve(__dirname, '..' + url);
                }
                // 相对路径
                else if (!url.startsWith('..')) {
                    // 当前文件夹
                    filepath = path.resolve(mdFile.path, '../' + url);
                }
                else {
                    // 非当前文件夹
                    filepath = path.resolve(mdFile.path, './' + url);
                }
                // 该文件是否存在
                try {
                    fs.statSync(filepath);
                }
                catch (e) {
                    inValidUrls.push(url);
                }
            }
        }
    }

    return inValidUrls;
}

/**
 * 校验 md 文件里所有 link 链接是否有效，如本地文件是否存在，网络资源是否可访问
 *
 * @public
 */
async function checkAllLink() {
    // 获取所有变动的 md 文件
    const diffMdFiles = getDiffMdFiles();
    if (diffMdFiles && diffMdFiles.length) {
        // 用来存放无效的链接地址，统一返回
        let inValidUrls = {};
        for (let mdFile of diffMdFiles) {
            try {
                const data = fs.readFileSync(mdFile.path, 'utf-8');
                // 校验每个文件里的无效 link
                const mdInValidUrls = await checkMdLink(data, mdFile);
                if (mdInValidUrls.length) {
                    inValidUrls[mdFile.subpath] = mdInValidUrls;
                }
            }
            catch (e) {
                console.error(e);
                process.exit(1);
            }
        }
        if (Object.keys(inValidUrls).length) {
            console.error('下列文件中的部分链接无效，请检查！~');
            console.error(inValidUrls);
            process.exit(1);
        }
    }
}

checkAllLink();
