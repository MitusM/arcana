module.exports = () => {
  return {
    module: {
      rules: [
        {
          // Картинки: webpack 5 asset modules вместо deprecated file-loader
          // (file-loader с outputPath писал JS-стабы в public/js/ и копии —
          //  из-за этого при каждой сборке в public/js/ появлялся мусор:
          //  lego.gif, rotating-square.gif, close2.svg, color-wheel.svg).
          // generator.filename '../images/[name][ext]' — эмитим в public/images/,
          // туда же, куда ссылаются url(../images/...) из CSS (public/css/style.css).
          test: /\.(gif|png|jpe?g|webp|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: '../images/[name][ext]',
          },
        },
      ],
    },
  };
};
